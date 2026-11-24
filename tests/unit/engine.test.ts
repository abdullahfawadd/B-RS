import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ZipFile } from "yazl";
import {
  createArchive,
  restoreToTemporary,
  sha256,
  validatePath,
  verifyArchive,
  type InputFile,
  type Limits,
} from "../../src/lib/engine";

const limits: Limits = { maxFiles: 3, maxFile: 2048, maxSource: 4096, maxArchive: 8192 };
const files: InputFile[] = [
  { path: "notes.txt", data: Buffer.from("Recovery drill") },
  { path: "records/november/data.csv", data: Buffer.from("id,status\n1,ready\n") },
  { path: "records/empty.txt", data: Buffer.alloc(0) },
];

async function zipFixture(entries: Record<string, string>): Promise<Buffer> {
  const zip = new ZipFile();
  for (const [path, text] of Object.entries(entries)) zip.addBuffer(Buffer.from(text), path);
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe("archive engine", () => {
  it("creates a ZIP with a manifest and restores nested and empty files from disk", async () => {
    const backup = await createArchive(files, limits);
    expect(backup.artifact.subarray(0, 2).toString()).toBe("PK");
    expect(backup.originalSize).toBe(files.reduce((size, file) => size + file.data.length, 0));
    expect(backup.checksum).toBe(sha256(backup.artifact));
    expect(backup.manifest.files[1]).toEqual({
      path: files[1].path,
      sha256: sha256(files[1].data),
      size: files[1].data.length,
    });
    const verified = await verifyArchive(backup.artifact, backup.checksum, limits, undefined, backup.manifest);
    expect(verified.files).toEqual(files);
    const restored = await restoreToTemporary(backup.artifact, backup.checksum, limits, undefined, backup.manifest);
    expect(restored.files).toEqual(files);
    expect(restored.bytes).toBe(backup.originalSize);
    expect(restored.failures).toEqual([]);
  });

  it("produces SHA-256 compatible with the published digest of abc", () => {
    expect(sha256(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("encrypts with a fresh nonce and verifies only with the correct AES key", async () => {
    const key = randomBytes(32);
    const first = await createArchive(files, limits, key);
    const second = await createArchive(files, limits, key);
    expect(first.artifact.equals(second.artifact)).toBe(false);
    expect(first.artifact.subarray(0, 2).toString()).not.toBe("PK");
    const result = await restoreToTemporary(first.artifact, first.checksum, limits, key, first.manifest);
    expect(result.files).toEqual(files);
    await expect(verifyArchive(first.artifact, first.checksum, limits)).rejects.toMatchObject({ code: "decryption" });
    await expect(verifyArchive(first.artifact, first.checksum, limits, randomBytes(32)))
      .rejects.toMatchObject({ code: "decryption" });
    const altered = Buffer.from(first.artifact);
    altered[altered.length - 1] ^= 1;
    await expect(verifyArchive(altered, sha256(altered), limits, key)).rejects.toMatchObject({ code: "decryption" });
  });

  it("rejects an artifact with changed bytes, truncated structure, or an unmatched manifest record", async () => {
    const backup = await createArchive(files, limits);
    const changed = Buffer.from(backup.artifact);
    changed[10] ^= 1;
    const incomplete = changed.subarray(0, changed.length - 28);
    const alteredManifest = structuredClone(backup.manifest);
    alteredManifest.files[0].sha256 = "0".repeat(64);
    await expect(verifyArchive(changed, backup.checksum, limits)).rejects.toMatchObject({ code: "corrupted" });
    await expect(verifyArchive(incomplete, sha256(incomplete), limits)).rejects.toMatchObject({ code: "corrupted" });
    await expect(verifyArchive(backup.artifact, backup.checksum, limits, undefined, alteredManifest))
      .rejects.toMatchObject({ code: "corrupted" });
  });

  it("rejects a readable ZIP with malformed manifest JSON", async () => {
    const zip = await zipFixture({ "manifest.json": "{", "files/notes.txt": "Recovery drill" });
    await expect(verifyArchive(zip, sha256(zip), limits)).rejects.toMatchObject({ code: "corrupted" });
  });

  it("compares the manifest file count and checksum independently of the archive checksum", async () => {
    const { manifest } = await createArchive([files[0]], limits);
    const manifestEntry = { "manifest.json": JSON.stringify(manifest) };
    const missing = await zipFixture(manifestEntry);
    const changed = await zipFixture({ ...manifestEntry, "files/notes.txt": "Corrupted data" });
    await expect(verifyArchive(missing, sha256(missing), limits)).rejects.toMatchObject({ code: "corrupted" });
    await expect(verifyArchive(changed, sha256(changed), limits)).rejects.toMatchObject({ code: "corrupted" });
  });

  it("rejects empty sources, individual overages, total overages, file-count and archive overages", async () => {
    await expect(createArchive([], limits)).rejects.toMatchObject({ code: "invalid" });
    await expect(createArchive([{ path: "big.bin", data: Buffer.alloc(2049) }], limits))
      .rejects.toMatchObject({ code: "limit" });
    await expect(createArchive(files, { ...limits, maxSource: 16 })).rejects.toMatchObject({ code: "limit" });
    await expect(createArchive(files, { ...limits, maxFiles: 2 })).rejects.toMatchObject({ code: "limit" });
    await expect(createArchive(files, { ...limits, maxArchive: 32 })).rejects.toMatchObject({ code: "limit" });
  });

  it("rejects duplicate paths, case-only collisions, and file/directory conflicts", async () => {
    const file = { path: "Nested.txt", data: Buffer.from("same") };
    for (const path of ["Nested.txt", "nested.txt", "nested.txt/child"]) {
      await expect(createArchive([file, { ...file, path }], limits)).rejects.toMatchObject({ code: "invalid" });
    }
  });
});

describe("portable relative paths", () => {
  it("preserves usable file and folder names", () => {
    expect(validatePath("Research notes/november/totals.csv")).toBe("Research notes/november/totals.csv");
  });

  it.each(["", ".", "..", "folder//name", "/absolute", "folder/../name", "C:/letter", "folder\\name",
    "CON.txt", "data/file.", "trailing /file", "folder/\0file"])("rejects invalid path %j", (path) => {
    expect(() => validatePath(path)).toThrow();
  });
});
