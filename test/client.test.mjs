import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_UPLOAD_BYTES,
  SOURCE_EXTENSIONS,
  Swap3DClient,
  Swap3DError,
  TARGET_FORMATS,
} from "../dist/index.js";

const jsonResponse = (payload, init = {}) =>
  new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });

test("runtime capabilities are exported from the versioned contract", () => {
  assert.deepEqual(TARGET_FORMATS, ["gltf", "glb", "gltf2", "glb2"]);
  assert.ok(SOURCE_EXTENSIONS.includes("obj"));
  assert.equal(MAX_UPLOAD_BYTES, 100 * 1024 * 1024);
});

test("getFormats does not require an API key", async () => {
  const calls = [];
  const client = new Swap3DClient({
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse({
        targetFormats: ["glb"],
        sourceExtensions: ["obj"],
        uploadLimitBytes: 104857600,
      });
    },
  });

  const result = await client.getFormats();

  assert.deepEqual(result.targetFormats, ["glb"]);
  assert.equal(calls[0].url, "https://api.swap3d.studio/api/v1/openapi/formats");
  assert.equal(new Headers(calls[0].options.headers).has("Authorization"), false);
});

test("authenticated calls send the API key", async () => {
  const client = new Swap3DClient({
    apiKey: "sk_test_example",
    fetch: async (_url, options) => {
      assert.equal(
        new Headers(options.headers).get("Authorization"),
        "Bearer sk_test_example",
      );
      return jsonResponse({
        usageCount: 2,
        limit: 100,
        remaining: 98,
        plan: "free",
        monthStart: "2026-07-01T00:00:00.000Z",
      });
    },
  });

  const usage = await client.getUsage();
  assert.equal(usage.remaining, 98);
});

test("createConversion builds the multipart request", async () => {
  const client = new Swap3DClient({
    apiKey: "sk_test_example",
    fetch: async (_url, options) => {
      assert.equal(options.method, "POST");
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get("targetFormat"), "glb");
      assert.equal(options.body.get("file").name, "cube.obj");
      return jsonResponse({
        message: "Conversion started",
        jobId: "job-1",
        statusUrl: "/api/v1/openapi/convert/status/job-1",
      }, { status: 202 });
    },
  });

  const result = await client.createConversion({
    file: new Blob(["o cube"]),
    fileName: "cube.obj",
    targetFormat: "glb",
  });
  assert.equal(result.jobId, "job-1");
});

test("waitForConversion returns the terminal status", async () => {
  const statuses = ["queued", "processing", "completed"];
  const seen = [];
  const client = new Swap3DClient({
    apiKey: "sk_test_example",
    fetch: async () => {
      const status = statuses.shift();
      return jsonResponse(
        status === "completed"
          ? {
              status,
              result: {
                downloadUrl: "https://download.example/model.glb",
                downloadUrlExpiresAt: "2026-07-29T03:00:00.000Z",
                outputExpiresAt: "2026-07-30T03:00:00.000Z",
                targetFormat: "glb",
              },
            }
          : { status },
      );
    },
  });

  const result = await client.waitForConversion("job-1", {
    intervalMs: 0,
    onStatus: (status) => seen.push(status.status),
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(seen, ["queued", "processing", "completed"]);
});

test("expired conversions are returned as a terminal status", async () => {
  const payload = {
    status: "expired",
    error: {
      code: "DOWNLOAD_EXPIRED",
      message: "Conversion output has expired.",
    },
    result: {
      targetFormat: "glb",
      outputExpiresAt: "2026-07-28T03:00:00.000Z",
    },
  };
  const client = new Swap3DClient({
    apiKey: "sk_test_example",
    fetch: async () => jsonResponse(payload, { status: 410 }),
  });

  assert.deepEqual(await client.getConversionStatus("job-1"), payload);
});

test("structured API errors include status and request metadata", async () => {
  const client = new Swap3DClient({
    apiKey: "sk_test_example",
    maxRetries: 0,
    fetch: async () =>
      jsonResponse(
        { error: { code: "TOO_MANY_REQUESTS", message: "Slow down." } },
        {
          status: 429,
          headers: {
            "retry-after": "2",
            "x-request-id": "req-1",
          },
        },
      ),
  });

  await assert.rejects(
    client.getUsage(),
    (error) =>
      error instanceof Swap3DError &&
      error.code === "TOO_MANY_REQUESTS" &&
      error.status === 429 &&
      error.retryAfterMs === 2000 &&
      error.requestId === "req-1",
  );
});

test("idempotent requests retry transient failures", async () => {
  let attempts = 0;
  const client = new Swap3DClient({
    maxRetries: 1,
    fetch: async () => {
      attempts += 1;
      if (attempts === 1) {
        return jsonResponse(
          { error: { code: "SERVICE_UNAVAILABLE", message: "Try again." } },
          { status: 503, headers: { "retry-after": "0" } },
        );
      }
      return jsonResponse({
        targetFormats: ["glb"],
        sourceExtensions: ["obj"],
        uploadLimitBytes: 104857600,
      });
    },
  });

  await client.getFormats();
  assert.equal(attempts, 2);
});

test("download resolves root-relative API URLs without duplicating the base path", async () => {
  let requestedUrl;
  const client = new Swap3DClient({
    baseUrl: "https://api.example.test/api/v1",
    fetch: async (url) => {
      requestedUrl = String(url);
      return new Response("model");
    },
  });

  await client.download("/downloads/job.glb");

  assert.equal(requestedUrl, "https://api.example.test/downloads/job.glb");
});
