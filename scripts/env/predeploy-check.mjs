#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const target = process.argv[2];
if (!target || !["staging", "prod"].includes(target)) {
  console.error("[predeploy-check] usage: node scripts/env/predeploy-check.mjs <staging|prod>");
  process.exit(1);
}

const branch = process.env.GIT_BRANCH || process.env.BRANCH || "";
if (!branch) {
  console.warn("[predeploy-check] GIT_BRANCH not provided, branch gate skipped.");
} else {
  if (target === "staging" && branch !== "staging") {
    console.error(`[predeploy-check] expected branch staging, got: ${branch}`);
    process.exit(2);
  }
  if (target === "prod" && branch !== "main") {
    console.error(`[predeploy-check] expected branch main, got: ${branch}`);
    process.exit(2);
  }
}

const template = target === "staging" ? ".env.staging.example" : "env.production.example";
const absolutePath = path.resolve(process.cwd(), template);
if (!fs.existsSync(absolutePath)) {
  console.error(`[predeploy-check] template not found: ${template}`);
  process.exit(3);
}

const content = fs.readFileSync(absolutePath, "utf8");
const requiredKeys = content
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#") && line.includes("="))
  .map((line) => line.split("=")[0].trim());

const requiredCore = ["VITE_SITE_URL", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"];
const missingInTemplate = requiredCore.filter((key) => !requiredKeys.includes(key));
if (missingInTemplate.length) {
  console.error("[predeploy-check] template missing required keys:");
  for (const key of missingInTemplate) console.error(`- ${key}`);
  process.exit(4);
}

console.log(`[predeploy-check] target=${target}`);
console.log(`[predeploy-check] template=${template}`);
console.log("[predeploy-check] branch gate passed.");
console.log("[predeploy-check] required key gate passed.");
process.exit(0);

