import { Swap3DError } from "./error.js";
import type {
  ConversionAccepted,
  ConversionStatus,
  CreateConversionInput,
  DownloadOptions,
  ExpiredConversion,
  FormatsResponse,
  RequestOptions,
  UsageResponse,
  WaitForConversionOptions,
} from "./types.js";

export const DEFAULT_API_URL = "https://api.swap3d.studio/api/v1";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface Swap3DClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: Fetcher;
  timeoutMs?: number;
  maxRetries?: number;
}

interface InternalRequestOptions {
  method?: string;
  body?: BodyInit;
  headers?: HeadersInit;
  signal?: AbortSignal;
  auth?: boolean;
  retry?: boolean;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const normalizeBaseUrl = (value?: string) =>
  String(value || DEFAULT_API_URL).trim().replace(/\/+$/, "");

const parseRetryAfter = (value: string | null): number | undefined => {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return undefined;
  }

  return Math.max(date - Date.now(), 0);
};

const readResponseBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => undefined);
  }

  return response.text().catch(() => undefined);
};

const getErrorDetails = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const value = payload as {
    error?: { code?: unknown; message?: unknown } | unknown;
    message?: unknown;
  };
  if (value.error && typeof value.error === "object") {
    const error = value.error as { code?: unknown; message?: unknown };
    return {
      code: typeof error.code === "string" ? error.code : undefined,
      message: typeof error.message === "string" ? error.message : undefined,
    };
  }

  return {
    message: typeof value.message === "string" ? value.message : undefined,
  };
};

const abortError = (message = "The operation was aborted.") =>
  new Swap3DError(message, { code: "ABORTED" });

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const isExpiredConversion = (value: unknown): value is ExpiredConversion =>
  Boolean(value && typeof value === "object" && (value as { status?: unknown }).status === "expired");

export class Swap3DClient {
  readonly baseUrl: string;

  private readonly apiKey?: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: Swap3DClientOptions = {}) {
    if (!options.fetch && typeof globalThis.fetch !== "function") {
      throw new Swap3DError("A Fetch API implementation is required.", {
        code: "FETCH_UNAVAILABLE",
      });
    }

    this.apiKey = options.apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = Math.max(options.maxRetries ?? 2, 0);
  }

  async getFormats(options: RequestOptions = {}): Promise<FormatsResponse> {
    return this.requestJson<FormatsResponse>("/openapi/formats", {
      auth: false,
      signal: options.signal,
      retry: true,
    });
  }

  async getUsage(options: RequestOptions = {}): Promise<UsageResponse> {
    return this.requestJson<UsageResponse>("/openapi/usage", {
      signal: options.signal,
      retry: true,
    });
  }

  async createConversion(input: CreateConversionInput): Promise<ConversionAccepted> {
    const fileName =
      input.fileName ||
      (typeof (input.file as Blob & { name?: unknown }).name === "string"
        ? String((input.file as Blob & { name: string }).name)
        : "");

    if (!fileName) {
      throw new Swap3DError("fileName is required when file is not a File.", {
        code: "INVALID_FILE",
      });
    }

    const form = new FormData();
    form.append("targetFormat", input.targetFormat);
    form.append("file", input.file, fileName);

    return this.requestJson<ConversionAccepted>("/openapi/convert", {
      method: "POST",
      body: form,
      signal: input.signal,
      retry: false,
    });
  }

  async getConversionStatus(
    jobId: string,
    options: RequestOptions = {},
  ): Promise<ConversionStatus> {
    if (!jobId) {
      throw new Swap3DError("jobId is required.", { code: "INVALID_JOB_ID" });
    }

    try {
      return await this.requestJson<ConversionStatus>(
        `/openapi/convert/status/${encodeURIComponent(jobId)}`,
        {
          signal: options.signal,
          retry: true,
        },
      );
    } catch (error) {
      if (
        error instanceof Swap3DError &&
        error.status === 410 &&
        isExpiredConversion(error.details)
      ) {
        return error.details;
      }
      throw error;
    }
  }

  async waitForConversion(
    jobId: string,
    options: WaitForConversionOptions = {},
  ): Promise<ConversionStatus> {
    const intervalMs = Math.max(options.intervalMs ?? 2_000, 0);
    const timeoutMs = Math.max(options.timeoutMs ?? 10 * 60_000, 1);
    const startedAt = Date.now();

    while (true) {
      const status = await this.getConversionStatus(jobId, { signal: options.signal });
      await options.onStatus?.(status);

      if (
        status.status === "completed" ||
        status.status === "failed" ||
        status.status === "expired"
      ) {
        return status;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new Swap3DError(`Timed out waiting for conversion job ${jobId}.`, {
          code: "POLL_TIMEOUT",
        });
      }

      await sleep(intervalMs, options.signal);
    }
  }

  async download(downloadUrl: string, options: DownloadOptions = {}): Promise<Response> {
    if (!downloadUrl) {
      throw new Swap3DError("downloadUrl is required.", {
        code: "INVALID_DOWNLOAD_URL",
      });
    }

    return this.request(downloadUrl, {
      auth: false,
      signal: options.signal,
      retry: true,
    });
  }

  private requireApiKey(): string {
    if (!this.apiKey) {
      throw new Swap3DError("A Swap3D API key is required for this operation.", {
        code: "MISSING_API_KEY",
      });
    }
    return this.apiKey;
  }

  private resolveUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      return pathOrUrl;
    }
    return `${this.baseUrl}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
  }

  private async requestJson<T>(
    pathOrUrl: string,
    options: InternalRequestOptions = {},
  ): Promise<T> {
    const response = await this.request(pathOrUrl, options);
    const payload = await readResponseBody(response);
    if (payload === undefined) {
      throw new Swap3DError("The Swap3D API returned an empty or invalid JSON response.", {
        code: "INVALID_RESPONSE",
        status: response.status,
        requestId: response.headers.get("x-request-id") || undefined,
      });
    }
    return payload as T;
  }

  private async request(
    pathOrUrl: string,
    options: InternalRequestOptions = {},
  ): Promise<Response> {
    const url = this.resolveUrl(pathOrUrl);
    const headers = new Headers(options.headers);
    if (!headers.has("Accept")) {
      headers.set("Accept", "application/json");
    }
    if (options.auth !== false) {
      headers.set("Authorization", `Bearer ${this.requireApiKey()}`);
    }

    const retryable = options.retry === true;
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchOnce(url, {
          method: options.method ?? "GET",
          body: options.body,
          headers,
          signal: options.signal,
        });
      } catch (error) {
        const swap3dError =
          error instanceof Swap3DError
            ? error
            : new Swap3DError("Unable to reach the Swap3D API.", {
                code: "NETWORK_ERROR",
                cause: error,
              });

        if (
          retryable &&
          attempt < this.maxRetries &&
          (swap3dError.code === "NETWORK_ERROR" || swap3dError.code === "TIMEOUT")
        ) {
          await sleep(250 * 2 ** attempt, options.signal);
          continue;
        }
        throw swap3dError;
      }

      if (response.ok) {
        return response;
      }

      const payload = await readResponseBody(response);
      const details = getErrorDetails(payload);
      const error = new Swap3DError(
        details.message || `Swap3D API request failed with HTTP ${response.status}.`,
        {
          code: details.code || `HTTP_${response.status}`,
          status: response.status,
          requestId: response.headers.get("x-request-id") || undefined,
          retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
          details: payload,
        },
      );

      if (retryable && attempt < this.maxRetries && RETRYABLE_STATUS.has(response.status)) {
        await sleep(error.retryAfterMs ?? 250 * 2 ** attempt, options.signal);
        continue;
      }
      throw error;
    }
  }

  private async fetchOnce(url: string, init: RequestInit): Promise<Response> {
    if (init.signal?.aborted) {
      throw abortError();
    }

    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      return await this.fetcher(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) {
        throw new Swap3DError(`Swap3D API request timed out after ${this.timeoutMs} ms.`, {
          code: "TIMEOUT",
          cause: error,
        });
      }
      if (init.signal?.aborted) {
        throw abortError();
      }
      throw error;
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", onAbort);
    }
  }
}
