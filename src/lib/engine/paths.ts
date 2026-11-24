import { EngineError } from "./types";

const invalidCharacters = /[\p{Cc}\p{Cs}<>:"\\|?*]/u;
const windowsDevice = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;

export function validatePath(path: string): string {
  if (!path || Buffer.byteLength(path) > 1024 || invalidCharacters.test(path)) {
    throw new EngineError("invalid", "File paths must be portable relative paths.");
  }
  for (const segment of path.split("/")) {
    if (!segment || segment.endsWith(".") || segment.endsWith(" ") ||
        Buffer.byteLength(segment) > 255 || windowsDevice.test(segment)) {
      throw new EngineError("invalid", "A filename or folder name is not supported on all platforms.");
    }
  }
  return path;
}

export function validatePaths(paths: Iterable<string>): void {
  const entries = new Map<string, { path: string; directory: boolean }>();
  for (const path of paths) {
    const parts = validatePath(path).split("/");
    for (let index = 0; index < parts.length; index++) {
      const prefix = parts.slice(0, index + 1).join("/");
      const directory = index !== parts.length - 1;
      const key = prefix.normalize("NFC").toLowerCase();
      const existing = entries.get(key);
      if (existing && (!directory || !existing.directory || existing.path !== prefix)) {
        throw new EngineError("invalid", "The source contains conflicting or duplicate paths.");
      }
      entries.set(key, { path: prefix, directory });
    }
  }
}
