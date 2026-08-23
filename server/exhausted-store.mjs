import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function createExhaustedStore(runtimeDir) {
  const file = join(runtimeDir, "exhausted-channels.json");
  let cache = { channels: {}, updatedAt: null };

  async function load() {
    try {
      cache = JSON.parse(await readFile(file, "utf8"));
    } catch {
      cache = { channels: {}, updatedAt: null };
    }
    return cache;
  }

  async function save() {
    await mkdir(runtimeDir, { recursive: true });
    cache.updatedAt = new Date().toISOString();
    await writeFile(file, JSON.stringify(cache, null, 2), "utf8");
    return cache;
  }

  async function mark(channel, reason = "") {
    await load();
    cache.channels[channel] = {
      exhausted: true,
      reason: String(reason || "").slice(0, 240),
      at: new Date().toISOString()
    };
    return save();
  }

  async function clear(channel) {
    await load();
    if (channel) delete cache.channels[channel];
    else cache.channels = {};
    return save();
  }

  async function snapshot() {
    await load();
    return cache;
  }

  return { load, mark, clear, snapshot };
}
