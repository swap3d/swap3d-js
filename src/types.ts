import type { SOURCE_EXTENSIONS, TARGET_FORMATS } from "./generated/capabilities.js";
import type { components } from "./generated/schema.js";

export type TargetFormat = (typeof TARGET_FORMATS)[number];
export type SourceExtension = (typeof SOURCE_EXTENSIONS)[number];
export type FormatsResponse = components["schemas"]["FormatsResponse"];
export type UsageResponse = components["schemas"]["UsageResponse"];
export type ConversionAccepted = components["schemas"]["ConversionAccepted"];
export type ActiveConversionStatus = components["schemas"]["ConversionStatus"];
export type ExpiredConversion = components["schemas"]["ExpiredConversion"];
export type ConversionStatus = ActiveConversionStatus | ExpiredConversion;
export type ConversionResult = components["schemas"]["ConversionResult"];
export type ApiErrorResponse = components["schemas"]["ErrorResponse"];

export interface CreateConversionInput {
  file: Blob;
  fileName?: string;
  targetFormat: TargetFormat;
  signal?: AbortSignal;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface WaitForConversionOptions extends RequestOptions {
  intervalMs?: number;
  timeoutMs?: number;
  onStatus?: (status: ConversionStatus) => void | Promise<void>;
}

export interface DownloadOptions extends RequestOptions {}
