#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL } from "node:url";

const defaultCodecPath = "/tmp/codex-app-asar/webview/assets/spreadsheet-Bpv2Ypgr.js";
const codecPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultCodecPath;
const moduleUrl = pathToFileURL(codecPath).href;
const codec = await import(moduleUrl);

const codecExports = Object.entries(codec)
  .filter(([, value]) => value && typeof value === "object" && typeof value.decode === "function")
  .map(([name, value]) => ({
    name,
    methods: Object.keys(value),
    defaultValue: typeof value.create === "function" ? value.create() : undefined,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const enumExports = Object.entries(codec)
  .filter(([, value]) => value && typeof value === "object" && typeof value.decode !== "function")
  .map(([name, value]) => ({
    name,
    values: Object.fromEntries(Object.entries(value).filter(([key]) => Number.isNaN(Number(key)))),
  }))
  .filter((entry) => Object.keys(entry.values).length > 0)
  .sort((a, b) => a.name.localeCompare(b.name));

console.log(
  JSON.stringify(
    {
      codecPath,
      protobufPackage: codec.protobufPackage,
      codecExports,
      enumExports,
    },
    null,
    2,
  ),
);
