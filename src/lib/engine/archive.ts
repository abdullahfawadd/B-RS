import { crc32 } from "node:zlib";
import type { Readable } from "node:stream";
import { fromBufferPromise, type Entry, type ZipFile as OpenZip } from "yauzl";
import { ZipFile } from "yazl";
import { z } from "zod";
import { decryptArchive, encryptArchive, encryptionOverhead, sha256 } from "./crypto";
import { validatePath, validatePaths } from "./paths";
import { EngineError, type InputFile, type Limits, type Manifest } from "./types";

const manifestPath = "manifest.json";
const sourcePrefix = "files/";
const maxManifestBytes = 1024 * 1024;
const manifestSchema = z.strictObject({
  version: z.literal(1),
  files: z.array(z.strictObject({
    path: z.string(),
    size: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })).min(1),
});

async function readBounded(stream: AsyncIterable<Buffer>, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > cap) throw new EngineError("limit", "The archive exceeds a configured size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function checkSizes(files: Array<{ size: number }>, limits: Limits): number {
  if (files.length > limits.maxFiles) throw new EngineError("limit", "The source has too many files.");
  let size = 0;
  for (const file of files) {
    if (file.size > limits.maxFile) throw new EngineError("limit", "A file exceeds the per-file size limit.");
    size += file.size;
    if (size > limits.maxSource) throw new EngineError("limit", "The source exceeds the total size limit.");
  }
  return size;
}

export async function createArchive(files: InputFile[], limits: Limits, key?: Buffer) {
  if (!files.length) throw new EngineError("invalid", "Add at least one file to the source before creating a backup.");
  const originalSize = checkSizes(files.map(({ data }) => ({ size: data.length })), limits);
  validatePaths(files.map((file) => file.path));
  const manifest: Manifest = {
    version: 1,
    files: files.map(({ path, data }) => ({ path, size: data.length, sha256: sha256(data) })),
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  if (manifestBytes.length > maxManifestBytes) throw new EngineError("limit", "The backup manifest is too large.");

  const zip = new ZipFile();
  const output = zip.outputStream as Readable;
  zip.on("error", (error: Error) => output.destroy(error));
  zip.addBuffer(manifestBytes, manifestPath);
  for (const file of files) zip.addBuffer(file.data, sourcePrefix + file.path);
  zip.end();

  const archive = await readBounded(output, limits.maxArchive - (key ? encryptionOverhead : 0));
  const artifact = key ? encryptArchive(archive, key) : archive;
  return { artifact, checksum: sha256(artifact), manifest, originalSize };
}

async function readEntry(zip: OpenZip, entry: Entry, maxSize: number): Promise<Buffer> {
  if (entry.uncompressedSize > maxSize) {
    throw new EngineError("limit", "An archive entry exceeds its size limit.");
  }

  const unixMode = (entry.externalFileAttributes >>> 16) & 0o170000;
  if ((unixMode !== 0 && unixMode !== 0o100000) || !entry.canDecodeFileData()) {
    throw new EngineError("corrupted", "The archive contains an unsupported entry type.");
  }
  const header = await zip.readLocalFileHeaderPromise(entry);
  const usesDescriptor = (entry.generalPurposeBitFlag & 0x0008) !== 0;
  if (!header.fileName.equals(entry.fileNameRaw) ||
      header.compressionMethod !== entry.compressionMethod ||
      header.generalPurposeBitFlag !== entry.generalPurposeBitFlag ||
      (!usesDescriptor && (header.crc32 !== entry.crc32 ||
        header.compressedSize !== entry.compressedSize || header.uncompressedSize !== entry.uncompressedSize))) {
    throw new EngineError("corrupted", "The ZIP headers disagree about an archive entry.");
  }
  const data = await readBounded(await zip.openReadStreamPromise(entry), entry.uncompressedSize);
  if (data.length !== entry.uncompressedSize || crc32(data) !== entry.crc32) {
    throw new EngineError("corrupted", "An archive entry failed its ZIP integrity check.");
  }
  return data;
}

async function readZip(buffer: Buffer, limits: Limits) {
  const zip = await fromBufferPromise(buffer, { strictFileNames: true, validateEntrySizes: true });
  try {
    if (zip.entryCount > limits.maxFiles + 1) {
      throw new EngineError("limit", "The archive has too many entries.");
    }
    let manifest: Manifest | undefined;
    let bytes = 0;
    const entries = new Map<string, Buffer>();
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName === manifestPath && !manifest) {
        const data = await readEntry(zip, entry, maxManifestBytes);
        const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
        manifest = manifestSchema.parse(parsed);
        checkSizes(manifest.files, limits);
        validatePaths(manifest.files.map((file) => file.path));
        continue;
      }
      if (!entry.fileName.startsWith(sourcePrefix)) {
        throw new EngineError("corrupted", "The archive contains an unexpected entry.");
      }
      const path = validatePath(entry.fileName.slice(sourcePrefix.length));
      if (entries.has(path)) throw new EngineError("corrupted", "The archive contains a duplicate filename.");
      const data = await readEntry(zip, entry, Math.min(limits.maxFile, limits.maxSource - bytes));
      entries.set(path, data);
      bytes += data.length;
    }
    if (!manifest || entries.size !== manifest.files.length) {
      throw new EngineError("corrupted", "The manifest and archive file counts disagree.");
    }
    const files = manifest.files.map((file) => {
      const data = entries.get(file.path);
      if (!data || data.length !== file.size || sha256(data) !== file.sha256) {
        throw new EngineError("corrupted", "An archive file does not match its manifest entry.");
      }
      return { path: file.path, data };
    });
    return { manifest, files };
  } finally {
    zip.close();
  }
}

export async function verifyArchive(
  artifact: Buffer,
  checksum: string,
  limits: Limits,
  key?: Buffer,
  expectedManifest?: Manifest,
): Promise<{ manifest: Manifest; files: InputFile[] }> {
  if (artifact.length > limits.maxArchive) throw new EngineError("limit", "The stored archive exceeds the size limit.");
  if (sha256(artifact) !== checksum) throw new EngineError("corrupted", "The stored archive checksum does not match.");

  const buffer = decryptArchive(artifact, key);
  try {
    const result = await readZip(buffer, limits);
    if (expectedManifest && JSON.stringify(manifestSchema.parse(expectedManifest)) !== JSON.stringify(result.manifest)) {
      throw new EngineError("corrupted", "The stored backup record disagrees with the archive manifest.");
    }
    return result;
  } catch (cause) {
    if (cause instanceof EngineError && cause.code !== "invalid") throw cause;
    throw new EngineError("corrupted", "The ZIP structure or backup manifest is invalid.", { cause });
  }
}
