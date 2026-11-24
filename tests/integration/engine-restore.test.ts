import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createArchive, restoreToTemporary, type InputFile, type Limits } from "../../src/lib/engine";
import * as fs from "node:fs/promises";

const harness = vi.hoisted(() => ({ directories: [] as string[], fault: "" }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  const mkdtemp = async (prefix: string) => {
    const directory = await actual.mkdtemp(prefix);
    harness.directories.push(directory);
    return directory;
  };
  const writeFile: typeof fs.writeFile = async (path, data, options) => {
    if (typeof path === "string" && path.endsWith("temperature.csv")) {
      if (harness.fault === "modified") {
        await actual.writeFile(path, Buffer.alloc(Buffer.byteLength(data as Buffer), 120), options);
        return;
      }
      if (harness.fault === "missing") return;
      if (harness.fault === "existing") await actual.writeFile(path, Buffer.from("existing file"));
    }
    return actual.writeFile(path, data, options);
  };
  return { ...actual, mkdtemp, writeFile };
});

const limits: Limits = { maxFiles: 10, maxFile: 1024, maxSource: 2048, maxArchive: 4096 };
const sourceFiles: InputFile[] = [
  { path: "log.txt", data: Buffer.from("Station archive drill") },
  { path: "readings/temperature.csv", data: Buffer.from("sample,celsius\n1,21\n") },
];

async function restored() {
  const backup = await createArchive(sourceFiles, limits);
  return restoreToTemporary(backup.artifact, backup.checksum, limits, undefined, backup.manifest);
}

afterEach(async () => {
  try {
    for (const directory of harness.directories) await expect(fs.stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    harness.directories.length = 0;
    harness.fault = "";
  }
});

describe("restore drill isolation and cleanup", () => {
  it("recreates nested files under a unique destination without touching an existing file", async () => {
    const sentinelDirectory = await fs.mkdtemp(join(tmpdir(), "brs-sentinel-"));
    const sentinel = join(sentinelDirectory, "log.txt");
    try {
      await fs.writeFile(sentinel, "original source contents");
      const [first, second] = await Promise.all([restored(), restored()]);
      expect(first.files).toEqual(sourceFiles);
      expect(second.files).toEqual(sourceFiles);
      expect(first.restoreMs).toBeGreaterThanOrEqual(0);
      expect(first.verificationMs).toBeGreaterThanOrEqual(0);
      expect(first.failures).toEqual([]);
      expect(new Set(harness.directories).size).toBe(3);
      expect(await fs.readFile(sentinel, "utf8")).toBe("original source contents");
    } finally {
      await fs.rm(sentinelDirectory, { recursive: true, force: true });
    }
  });

  it.each(["modified", "missing"])("records partial verification when a restored file is %s", async (fault) => {
    harness.fault = fault;
    const result = await restored();
    expect(result.files).toEqual([sourceFiles[0]]);
    expect(result.failures).toEqual([
      { path: "readings/temperature.csv", error: expect.stringMatching(fault === "modified" ? /checksum/ : /missing/) },
    ]);
  });

  it("fails on a destination collision and still removes the temporary directory", async () => {
    harness.fault = "existing";
    await expect(restored()).rejects.toMatchObject({ code: "EEXIST" });
    expect(harness.directories).toHaveLength(1);
  });

  it("leaves no temporary directory when the checksum precheck fails", async () => {
    const backup = await createArchive(sourceFiles, limits);
    await expect(restoreToTemporary(backup.artifact, "0".repeat(64), limits))
      .rejects.toMatchObject({ code: "corrupted" });
    expect(harness.directories).toEqual([]);
  });
});
