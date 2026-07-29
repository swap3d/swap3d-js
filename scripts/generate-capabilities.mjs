import { writeFile } from "node:fs/promises";

const contractUrl =
  "https://raw.githubusercontent.com/swap3d/swap3d-openapi/v0.1.0/openapi.json";
const response = await fetch(contractUrl);

if (!response.ok) {
  throw new Error(`Unable to load OpenAPI contract: HTTP ${response.status}`);
}

const contract = await response.json();
const schemas = contract?.components?.schemas;
const targetFormats = schemas?.TargetFormat?.enum;
const sourceExtensions = schemas?.SourceExtension?.enum;
const uploadLimitBytes = schemas?.FormatsResponse?.properties?.uploadLimitBytes?.example;

if (
  !Array.isArray(targetFormats) ||
  !targetFormats.every((value) => typeof value === "string") ||
  !Array.isArray(sourceExtensions) ||
  !sourceExtensions.every((value) => typeof value === "string") ||
  !Number.isSafeInteger(uploadLimitBytes) ||
  uploadLimitBytes <= 0
) {
  throw new Error("OpenAPI contract does not contain valid runtime capabilities.");
}

const source = `// Generated from swap3d/swap3d-openapi v0.1.0. Do not edit manually.
export const TARGET_FORMATS = ${JSON.stringify(targetFormats)} as const;
export const SOURCE_EXTENSIONS = ${JSON.stringify(sourceExtensions)} as const;
export const MAX_UPLOAD_BYTES = ${uploadLimitBytes};
`;

await writeFile(new URL("../src/generated/capabilities.ts", import.meta.url), source);
