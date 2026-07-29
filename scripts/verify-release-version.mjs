import process from "node:process";
import { readFile } from "node:fs/promises";

const tag = process.argv[2] || process.env.GITHUB_REF_NAME || "";
const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url))).version;

if (tag !== `v${version}`) {
  console.error(`Release tag ${tag || "(missing)"} does not match package version ${version}.`);
  process.exit(1);
}
