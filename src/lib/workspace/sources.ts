import "server-only";
import { randomUUID } from "node:crypto";
import { EngineError, sha256, validatePath } from "@/lib/engine";
import { checked, encryptionKey, isoNow, RequestError, required, type Workspace } from "./core";
import type { Action } from "./validation";

export async function saveSource(ws: Workspace, input: Action<"source-save">) {
  encryptionKey(input.encryption_enabled);
  const { name, description, auto_test, encryption_enabled } = input;
  const fields = { name, description, auto_test, encryption_enabled, updated_at: isoNow() };
  const id = input.id ?? randomUUID();
  if (input.id) {
    await ws.source(id);
    checked(await ws.db.from("backup_sources").update(fields).eq("id", id).eq("user_id", ws.user));
  } else {
    checked(await ws.db.from("backup_sources").insert({
      ...fields, id, user_id: ws.user, storage_path: `${ws.user}/${id}`,
    }));
  }
  await ws.audit(input.id ? "source_update" : "source_create", "source", id);
  return { id };
}

export async function deleteSource(ws: Workspace, id: string) {
  await ws.source(id, true);
  checked(await ws.db.from("backup_sources").update({ status: "deleting" }).eq("id", id).eq("user_id", ws.user));
  checked(await ws.db.from("backup_schedules").update({ enabled: false }).eq("source_id", id).eq("user_id", ws.user));
  const files = checked(await ws.db.from("source_files").select("storage_path").eq("source_id", id).eq("user_id", ws.user)) ?? [];
  await ws.deleteObjects("source-files", files.map((file) => file.storage_path));
  checked(await ws.db.from("source_files").delete().eq("source_id", id).eq("user_id", ws.user));
  checked(await ws.db.from("backup_sources").update({ status: "deleted", updated_at: isoNow() }).eq("id", id).eq("user_id", ws.user));
  await ws.audit("source_delete", "source", id);
  return { id };
}

export async function planUploads(ws: Workspace, input: Action<"upload-plan">) {
  const source = await ws.source(input.source_id);
  if (source.demo) {
    throw new RequestError("Add your files to a separate source. The demonstration source is reserved for fictional files.", 409);
  }
  const existing = checked(await ws.db.from("source_files").select("*").eq("source_id", source.id).eq("user_id", ws.user)) ?? [];
  const paths = new Map(existing.map((file) => [file.relative_path.toLowerCase(), file]));
  const requested = new Set<string>();
  let total = existing.reduce((sum, file) => sum + Number(file.file_size), 0);
  let count = existing.length;
  const files = input.files.map((file) => {
    let path: string;
    try { path = validatePath(file.path); }
    catch (error) { throw new RequestError(error instanceof EngineError ? error.message : "Invalid file path."); }
    const folded = path.toLowerCase();
    if (requested.has(folded)) throw new RequestError("Each source path must be unique.");
    requested.add(folded);
    if (file.size > ws.limits.maxFile) throw new RequestError("A file exceeds the per-file limit.", 413);
    const current = paths.get(folded);
    if (current) {
      if (current.status !== "pending" || current.relative_path !== path || current.file_size !== file.size) {
        throw new RequestError(`${path} already exists. Remove it before adding a replacement.`, 409);
      }
      return current;
    }
    total += file.size;
    count++;
    const id = randomUUID();
    return {
      id, source_id: source.id, user_id: ws.user, original_filename: path.split("/").at(-1),
      relative_path: path, storage_path: `${ws.user}/${source.id}/${id}`,
      file_size: file.size, mime_type: file.mime || "application/octet-stream",
    };
  });
  if (total > ws.limits.maxSource || count > ws.limits.maxFiles) {
    throw new RequestError("This selection exceeds the source size or file-count limit.", 413);
  }
  const fresh = files.filter((file) => !paths.has(file.relative_path.toLowerCase()));
  if (fresh.length) checked(await ws.db.from("source_files").insert(fresh));
  const uploads = [];
  for (const file of files) {
    const { token } = required(checked(await ws.db.storage.from("source-files").createSignedUploadUrl(file.storage_path)), "Upload slot");
    uploads.push({ id: file.id, path: file.relative_path, storage_path: file.storage_path, token });
  }
  return { uploads };
}

export async function completeUploads(ws: Workspace, input: Action<"upload-complete">) {
  await ws.source(input.source_id);
  const wanted = [...new Set(input.ids)];
  const rows = checked(await ws.db.from("source_files").select("*").eq("source_id", input.source_id).eq("user_id", ws.user).in("id", wanted)) ?? [];
  if (rows.length !== wanted.length) throw new RequestError("An upload reservation was not found.", 404);
  const files = [];
  for (const row of rows) {
    if (row.status === "ready") {
      files.push(row.id);
      continue;
    }
    const content = await ws.getObject("source-files", row.storage_path, ws.limits.maxFile);
    if (content.length !== row.file_size) {
      await ws.deleteObjects("source-files", [row.storage_path]);
      throw new RequestError(`The uploaded size for ${row.relative_path} did not match its reservation.`, 422);
    }
    const checksum = sha256(content);
    if (input.checksums?.[row.id] && input.checksums[row.id] !== checksum) {
      throw new RequestError("A pending file contains different bytes. Remove it before uploading a replacement.", 409);
    }
    checked(await ws.db.from("source_files").update({
      status: "ready", sha256_checksum: checksum, uploaded_at: isoNow(),
    }).eq("id", row.id).eq("user_id", ws.user));
    await ws.audit("file_upload", "file", row.id, "success", { bytes: content.length, source_id: input.source_id });
    files.push(row.id);
  }
  return { files };
}

export async function deleteFile(ws: Workspace, id: string) {
  const file = required(checked(await ws.row("source_files", id)), "File");
  await ws.source(file.source_id);
  await ws.deleteObjects("source-files", [file.storage_path]);
  checked(await ws.db.from("source_files").delete().eq("id", id).eq("user_id", ws.user));
  await ws.audit("file_delete", "file", id);
  return { id };
}
