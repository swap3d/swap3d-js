# Swap3D JavaScript SDK

The official TypeScript and JavaScript client for the
[Swap3D developer API](https://swap3d.studio/developer-api).

## Install

```shell
npm install @swap3d/sdk
```

Node.js 18 or newer is required. The SDK also works in modern runtimes that
provide the standard Fetch API, `Blob`, and `FormData`.

## Quickstart

```ts
import { readFile, writeFile } from "node:fs/promises";
import { Swap3DClient } from "@swap3d/sdk";

const client = new Swap3DClient({
  apiKey: process.env.SWAP3D_API_KEY,
});

const source = await readFile("./model.obj");
const job = await client.createConversion({
  file: new Blob([source]),
  fileName: "model.obj",
  targetFormat: "glb",
});

const status = await client.waitForConversion(job.jobId, {
  onStatus: ({ status }) => console.log(status),
});

if (status.status === "completed" && status.result) {
  const response = await client.download(status.result.downloadUrl);
  const output = new Uint8Array(await response.arrayBuffer());
  await writeFile("./model.glb", output);
}
```

Create API keys in the
[Swap3D dashboard](https://swap3d.studio/dashboard/api). Do not expose API keys
in browser code or commit them to source control.

## API

```ts
client.getFormats()
client.getUsage()
client.createConversion({ file, fileName, targetFormat })
client.getConversionStatus(jobId)
client.waitForConversion(jobId, options)
client.download(downloadUrl)
```

All methods accept abort signals where relevant. Safe GET requests retry
transient network, rate-limit, and service errors. Conversion submission is
not retried automatically.

API failures throw `Swap3DError`, which includes machine-readable `code`,
HTTP `status`, `requestId`, and `retryAfterMs` values when the server provides
them.

## Contract

Public types are generated from
[`swap3d-openapi`](https://github.com/swap3d/swap3d-openapi) `v0.1.0`.
Contract changes must be published there before updating this SDK.

## Development

```shell
npm ci
npm test
npm pack --dry-run
```

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
