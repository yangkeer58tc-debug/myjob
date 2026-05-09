#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const templatePath = process.argv[2] || ".env.staging.example";

const absolutePath = path.resolve(process.cwd(), templatePath);
if (!fs.existsSync(absolutePath)) {
  console.error(`[env-validate] file not found: ${absolutePath}`);
  process.exit(1);
}

const content = fs.readFileSync(absolutePath, "utf8");
const lines = content.split(/\r?\n/);

const required = [];
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  required.push({ key, hasDefault: value.length > 0 });
}

if (!required.length) {
  console.error("[env-validate] no env keys found in template");
  process.exit(1);
}

const missingRuntime = [];
for (const item of required) {
  if (item.hasDefault) continue;
  if (!process.env[item.key]) missingRuntime.push(item.key);
}

console.log(`[env-validate] template: ${templatePath}`);
console.log(`[env-validate] keys found: ${required.length}`);
if (!missingRuntime.length) {
  console.log("[env-validate] OK: all required runtime keys are present.");
  process.exit(0);
}

console.error("[env-validate] Missing required runtime keys:");
for (const key of missingRuntime) {
  console.error(`- ${key}`);
}
process.exit(2);

