import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { verifyArchive } from "./archive";
import { sha256 } from "./crypto";
import { validatePath } from "./paths";
import {
  EngineError,
  type InputFile,
  type Limits,
  type Manifest,
  type RestoreFailure,
  type RestoreResult,
} from "./types";

function confinedPath(root: string, path: string): string {
  const destination = resolve(root, validatePath(path));
  const location = relative(root, destination);
  if (location !== path.split("/").join(sep)) {
    throw new EngineError("corrupted", "A file resolved outside its restore destination.");
  }
  return destination;
}

async function inspectTree(root: string, expected: Manifest["files"]) {
  const expectedFiles = new Set<string>();
  const expectedFolders = new Set<string>();
  const restoredPaths = new Set<string>();
  const failures: RestoreFailure[] = [];
  for (const { path } of expected) {
    expectedFiles.add(path);
    let folder = path.lastIndexOf("/");
    while (folder !== -1) {
      expectedFolders.add(path.slice(0, folder));
      folder = path.lastIndexOf("/", folder - 1);
    }
  }

  async function scan(folder: string): Promise<void> {
    const entries = await fs.readdir(folder ? confinedPath(root, folder) : root, { withFileTypes: true });
    for (const entry of entries) {
      const path = folder ? folder + "/" + entry.name : entry.name;
      if (entry.isDirectory() && expectedFolders.has(path)) {
        await scan(path);
      } else if (expectedFiles.has(path)) {
        restoredPaths.add(path);
      } else if (expectedFolders.has(path)) {
        failures.push({ path, error: "The restored folder has an unexpected type." });
      } else {
        failures.push({ path, error: "Unexpected entry in restored directory." });
      }
    }
  }
  await scan("");
  return { restoredPaths, failures };
}

async function verifyRestoredFiles(root: string, manifest: Manifest) {
  const files: InputFile[] = [];
  const { restoredPaths, failures } = await inspectTree(root, manifest.files);
  let bytes = 0;
  for (const { path, size, sha256: digest } of manifest.files) {
    if (!restoredPaths.has(path)) {
      failures.push({ path, error: "Restored file is missing from the expected directory." });
      continue;
    }
    const diskPath = confinedPath(root, path);
    try {
      const stat = await fs.lstat(diskPath);
      if (!stat.isFile() || stat.size !== size) {
        failures.push({ path, error: "Restored file type or size differs from the manifest." });
        continue;
      }
      const data = await fs.readFile(diskPath);
      if (data.length !== size || sha256(data) !== digest) {
        failures.push({ path, error: "Restored content does not match the manifest checksum." });
        continue;
      }
      files.push({ path, data });
      bytes += data.length;
    } catch {
      failures.push({ path, error: "Restored file is missing or could not be read." });
    }
  }
  return { files, bytes, failures };
}

export async function restoreToTemporary(
  artifact: Buffer,
  checksum: string,
  limits: Limits,
  key?: Buffer,
  expectedManifest?: Manifest,
): Promise<RestoreResult> {
  const startedAt = performance.now();
  const { manifest, files } = await verifyArchive(artifact, checksum, limits, key, expectedManifest);
  const temporary = await fs.mkdtemp(join(tmpdir(), "brs-restore-"));
  try {
    for (const file of files) {
      const destination = confinedPath(temporary, file.path);
      await fs.mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await fs.writeFile(destination, file.data, { flag: "wx", mode: 0o600 });
    }
    const verificationStartedAt = performance.now();
    const verified = await verifyRestoredFiles(temporary, manifest);
    return {
      manifest,
      ...verified,
      restoreMs: Math.round(verificationStartedAt - startedAt),
      verificationMs: Math.round(performance.now() - verificationStartedAt),
    };
  } finally {
    // Remove only the directory returned by mkdtemp for this invocation.
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3 });
  }
}
