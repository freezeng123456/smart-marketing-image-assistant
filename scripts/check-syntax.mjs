import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const excluded = new Set(["node_modules", ".git"]);
const files = [];

function walk(directory) {
  for (const name of readdirSync(directory)) {
    if (excluded.has(name)) continue;
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else if (path.endsWith(".js") || path.endsWith(".mjs")) files.push(path);
  }
}

walk(root);
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    console.error(`Syntax check failed: ${relative(root, file)}`);
    console.error(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}
console.log(`Syntax check passed for ${files.length} JavaScript files.`);
