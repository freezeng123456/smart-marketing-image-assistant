import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function unquote(value) {
  const text = String(value || "").trim();
  if (
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")))
  ) {
    return text.slice(1, -1).replace(/\\n/g, "\n");
  }
  return text;
}

/**
 * Minimal dependency-free .env loader. Existing shell variables always win.
 * It intentionally does not print values and does not perform shell expansion.
 */
export async function loadEnvFile(path = ".env") {
  let content;
  try {
    content = await readFile(resolve(path), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { loaded: false, path: resolve(path) };
    throw error;
  }

  let count = 0;
  for (const originalLine of content.split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, name, rawValue] = match;
    if (process.env[name] !== undefined) continue;
    process.env[name] = unquote(rawValue);
    count += 1;
  }
  return { loaded: true, path: resolve(path), count };
}
