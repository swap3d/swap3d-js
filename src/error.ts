export interface Swap3DErrorOptions {
  code?: string;
  status?: number;
  requestId?: string;
  retryAfterMs?: number;
  details?: unknown;
  cause?: unknown;
}

export class Swap3DError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly retryAfterMs?: number;
  readonly details?: unknown;

  constructor(message: string, options: Swap3DErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "Swap3DError";
    this.code = options.code ?? "SWAP3D_ERROR";
    this.status = options.status;
    this.requestId = options.requestId;
    this.retryAfterMs = options.retryAfterMs;
    this.details = options.details;
  }
}
