import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(new URL("..", import.meta.url)));
const VENDOR = join(ROOT, "python-vendor");

/** Env for python3 so Render/local can import Pillow from ./python-vendor. */
export function pythonChildEnv(extra = {}) {
  const parts = [];
  if (existsSync(VENDOR)) parts.push(VENDOR);
  if (process.env.PYTHONPATH) parts.push(process.env.PYTHONPATH);
  return {
    ...process.env,
    ...extra,
    PYTHONPATH: parts.filter(Boolean).join(":") || process.env.PYTHONPATH || ""
  };
}

export function pythonVendorPath() {
  return VENDOR;
}
