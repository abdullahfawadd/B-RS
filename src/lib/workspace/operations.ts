import "server-only";
import { randomUUID } from "node:crypto";
import { createArchive, EngineError, restoreToTemporary, sha256, verifyArchive, type InputFile, type Manifest } from "@/lib/engine";
import { checked, elapsed, encryptionKey, isoNow, RequestError, required, safeError, type Workspace } from "./core";

type Point = {
  id: string; source_id: string; archive_path: string; checksum: string; name: string;
  encryption_enabled: boolean; manifest: Manifest; original_size: number; compressed_size: number;
};

function engineFailure(error: unknown) {
  if (error instanceof EngineError) {
    return new RequestError(error.message, error.code === "limit" ? 413 : 422, error.code);
  }
  return error;
}

async function readArchive(ws: Workspace, point: Point) {
  return ws.getObject("backup-archives", point.archive_path, ws.limits.maxArchive);
}

export async function runBackup(ws: Workspace, sourceId: string, id: string = randomUUID(), autoTest = true) {
  const source = await ws.source(sourceId);
  const job = checked(await ws.row("backup_jobs", id));
  if (job && job.source_id !== sourceId) throw new RequestError("Operation ID belongs to a different source.", 409);
  if (job && job.status !== "running") return { id, status: job.status };
  if (!job) checked(await ws.db.from("backup_jobs").insert({ id, user_id: ws.user, source_id: sourceId, status: "running" }));
  const started = performance.now();
  const archivePath = `${ws.user}/${id}/archive.bin`;
  try {
    if (job) await ws.deleteObjects("backup-archives", [archivePath]);
    const rows = checked(await ws.db.from("source_files").select("*").eq("source_id", sourceId)
      .eq("user_id", ws.user).order("relative_path")) ?? [];
    if (!rows.length) throw new RequestError("Upload at least one file before making a backup.", 422);
    if (rows.some((row) => row.status !== "ready")) throw new RequestError("Complete or remove the pending uploads before running a backup.", 409);
    if (rows.length > ws.limits.maxFiles ||
      rows.some((row) => row.file_size > ws.limits.maxFile) ||
      rows.reduce((sum, row) => sum + Number(row.file_size), 0) > ws.limits.maxSource) {
      throw new RequestError("Source exceeds the configured operation limits.", 413);
    }
    const files: InputFile[] = [];
    for (const row of rows) {
      const data = await ws.getObject("source-files", row.storage_path, ws.limits.maxFile);
      if (data.length !== row.file_size || sha256(data) !== row.sha256_checksum) {
        throw new RequestError(`Source file changed or is incomplete: ${row.relative_path}.`, 422);
      }
      files.push({ path: row.relative_path, data });
    }
    const key = encryptionKey(source.encryption_enabled);
    const archive = await createArchive(files, ws.limits, key);
    await ws.putObject("backup-archives", archivePath, archive.artifact);
    const stored = await ws.getObject("backup-archives", archivePath, ws.limits.maxArchive);
    await verifyArchive(stored, archive.checksum, ws.limits, key, archive.manifest);
    checked(await ws.db.rpc("finish_backup", {
      p_user: ws.user, p_id: id, p_duration: elapsed(started),
      p_backup: {
        name: source.name, archive_path: archivePath, original_size: archive.originalSize,
        compressed_size: stored.length, checksum: archive.checksum, manifest: archive.manifest,
        encryption_enabled: Boolean(key), encryption_version: key ? 1 : null, status: "verified",
      },
    }));
  } catch (error) {
    const failure = engineFailure(error);
    try {
      const persisted = checked(await ws.row("backups", id));
      if (persisted) return { id, status: "success" };
      await ws.deleteObjects("backup-archives", [archivePath]);
      checked(await ws.db.from("backup_jobs").update({
        status: "failed", completed_at: isoNow(), duration_ms: elapsed(started), error_message: safeError(failure),
      }).eq("id", id).eq("user_id", ws.user).eq("status", "running"));
      await ws.audit("backup", "job", id, "failed", { error: safeError(failure) });
    } catch { /* An interrupted job can be resumed with the same operation ID. */ }
    throw failure;
  }
  let testStatus: string | undefined;
  if (autoTest && source.auto_test) {
    try { testStatus = (await runRestore(ws, id, id, "test", "automatic")).status; }
    catch { testStatus = "failed"; }
  }
  return { id, status: "success", test_status: testStatus };
}

function integrityStatus(error: unknown) {
  if (error instanceof RequestError && error.code === "missing") return "missing";
  if (error instanceof EngineError && error.code === "corrupted") return "corrupted";
  return "failed";
}

export async function verifyPoint(ws: Workspace, id: string) {
  const point: Point = await ws.recoveryPoint(id);
  try {
    const artifact = await readArchive(ws, point);
    await verifyArchive(artifact, point.checksum, ws.limits, encryptionKey(point.encryption_enabled), point.manifest);
    checked(await ws.db.from("backups").update({ status: "verified", verified_at: isoNow() }).eq("id", id).eq("user_id", ws.user));
    await ws.audit("verify", "backup", id, "success");
    return { id, status: "verified" };
  } catch (error) {
    const status = integrityStatus(error);
    checked(await ws.db.from("backups").update({ status, verified_at: null }).eq("id", id).eq("user_id", ws.user));
    await ws.audit("verify", "backup", id, status, { error: safeError(engineFailure(error)) });
    return { id, status, error: safeError(engineFailure(error)) };
  }
}

export async function runRestore(
  ws: Workspace, backupId: string, id: string = randomUUID(), mode: "test" | "restore", trigger = "manual",
) {
  const point: Point = await ws.recoveryPoint(backupId);
  const test = mode === "test";
  const table = test ? "restore_tests" : "restore_operations";
  const existing = checked(await ws.row(table, id));
  if (existing && existing.backup_id !== backupId) throw new RequestError("Operation ID belongs to a different backup.", 409);
  if (existing && existing.status !== "running") return { id, status: existing.status };
  const destination = `${ws.user}/${id}`;
  if (!existing) checked(await ws.db.from(table).insert({
    id, user_id: ws.user, backup_id: backupId, status: "running",
    ...(test ? { trigger } : { restore_destination: destination }),
  }));
  const started = performance.now();
  const written: string[] = [];
  try {
    if (!test && existing) {
      await ws.deleteObjects("restored-files", point.manifest.files.map((_, index) => `${destination}/${index}`));
    }
    const artifact = await readArchive(ws, point);
    const restored = await restoreToTemporary(artifact, point.checksum, ws.limits, encryptionKey(point.encryption_enabled), point.manifest);
    const common = {
      completed_at: isoNow(), duration_ms: elapsed(started), restore_duration_ms: restored.restoreMs,
      verification_duration_ms: restored.verificationMs, bytes_restored: restored.bytes,
    };
    if (test) {
      const status = restored.failures.length ? (restored.files.length ? "partially_passed" : "failed") : "passed";
      const details = restored.manifest.files.map((file) => ({
        ...file, status: restored.failures.some((failure) => failure.path === file.path) ? "failed" : "verified",
        error: restored.failures.find((failure) => failure.path === file.path)?.error,
      }));
      checked(await ws.db.from(table).update({
        ...common, status, files_tested: restored.manifest.files.length, files_verified: restored.files.length,
        failed_files: restored.failures.length, verification_details: details,
      }).eq("id", id).eq("user_id", ws.user).eq("status", "running"));
      await ws.audit("restore_test", "restore_test", id, status, { backup_id: backupId, files_verified: restored.files.length });
      return { id, status };
    }
    if (restored.failures.length) throw new RequestError("Verification of the isolated restore failed.", 422);
    const output = [];
    let verification = restored.verificationMs;
    for (const [index, file] of restored.files.entries()) {
      const storagePath = `${destination}/${index}`;
      written.push(storagePath);
      await ws.putObject("restored-files", storagePath, file.data);
      const verifyStarted = performance.now();
      const copy = await ws.getObject("restored-files", storagePath, ws.limits.maxFile);
      const digest = sha256(file.data);
      if (sha256(copy) !== digest || copy.length !== file.data.length) throw new RequestError("Stored restore verification failed.", 422);
      verification += elapsed(verifyStarted);
      output.push({ path: file.path, storage_path: storagePath, size: copy.length, sha256: digest });
    }
    checked(await ws.db.from(table).update({
      ...common, completed_at: isoNow(), duration_ms: elapsed(started), verification_duration_ms: verification,
      status: "success", files_restored: output.length, output_files: output,
    }).eq("id", id).eq("user_id", ws.user).eq("status", "running"));
    await ws.audit("restore", "restore", id, "success", { backup_id: backupId, files_restored: output.length });
    return { id, status: "success" };
  } catch (error) {
    const message = safeError(engineFailure(error));
    try {
      const persisted = checked(await ws.row(table, id));
      if (persisted && persisted.status !== "running") return { id, status: persisted.status };
      await ws.deleteObjects("restored-files", written);
      checked(await ws.db.from(table).update({
        status: "failed", error_message: message, completed_at: isoNow(), duration_ms: elapsed(started),
        ...(test ? { verification_details: [{ stage: "restore", error: message }] } : {}),
      }).eq("id", id).eq("user_id", ws.user).eq("status", "running"));
      await ws.audit(test ? "restore_test" : "restore", test ? "restore_test" : "restore", id, "failed", { backup_id: backupId, error: message });
    } catch { /* The original failure is preserved when cleanup is temporarily unavailable. */ }
    return { id, status: "failed", error: message };
  }
}

export async function makeCorruptedCopy(ws: Workspace, backupId: string) {
  const point: Point = await ws.recoveryPoint(backupId);
  const source = await ws.source(point.source_id);
  if (!source.demo) throw new RequestError("Only fictional demo artifacts can be copied for the corruption demonstration.", 409);
  const id = randomUUID();
  const path = `${ws.user}/${id}/archive.bin`;
  const artifact = await readArchive(ws, point);
  artifact[Math.floor(artifact.length / 2)] ^= 1;
  checked(await ws.db.from("backup_jobs").insert({
    id, user_id: ws.user, source_id: point.source_id, status: "failed",
    completed_at: isoNow(), error_message: "Diagnostic copy was intentionally altered.",
  }));
  try {
    await ws.putObject("backup-archives", path, artifact);
    checked(await ws.db.from("backups").insert({
      id, user_id: ws.user, source_id: point.source_id, backup_job_id: id,
      name: `${point.name} (corrupted demo copy)`, archive_path: path,
      original_size: point.original_size, compressed_size: artifact.length, checksum: point.checksum,
      manifest: point.manifest, encryption_enabled: point.encryption_enabled,
      encryption_version: point.encryption_enabled ? 1 : null, status: "pending", demo_corrupt: true,
    }));
  } catch (error) {
    if (!checked(await ws.row("backups", id))) await ws.deleteObjects("backup-archives", [path]);
    throw error;
  }
  await ws.audit("demo_corrupt", "backup", id, "success");
  await verifyPoint(ws, id);
  return id;
}

export async function restoredFile(ws: Workspace, id: string, path: string) {
  const row = required(checked(await ws.row("restore_operations", id)), "Restore");
  if (row.status !== "success") throw new RequestError("Completed restore was not found.", 404);
  const file = (row.output_files as { path: string; storage_path: string }[]).find((entry) => entry.path === path);
  if (!file || !file.storage_path.startsWith(`${ws.user}/${id}/`)) throw new RequestError("Restored file was not found.", 404);
  const name = path.split("/").at(-1) || "recovered-file";
  const signed = required(checked(await ws.db.storage.from("restored-files").createSignedUrl(file.storage_path, 60, { download: name })), "Restored file");
  return signed.signedUrl;
}
