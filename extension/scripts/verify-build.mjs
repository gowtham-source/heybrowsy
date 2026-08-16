import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const contentPath = resolve("dist/content.js");
const content = readFileSync(contentPath, "utf8");

if (/^\s*import\s/m.test(content)) {
  throw new Error("dist/content.js contains an ES module import and cannot be injected with chrome.scripting.executeScript");
}

if (!content.includes("HB_PING")) {
  throw new Error("dist/content.js is missing the heybrowsy message receiver");
}

console.log("Verified standalone injectable content script.");
