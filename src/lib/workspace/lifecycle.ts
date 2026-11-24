import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { sha256 } from "@/lib/engine";
import { nextRun } from "@/lib/schedule";
import { retentionPlan } from "@/lib/retention";
import { checked, isoNow, RequestError, required, safeError, type Workspace } from "./core";
import { deleteSource } from "./sources";
import { makeCorruptedCopy, runBackup, runRestore, verifyPoint } from "./operations";
import type { Action } from "./validation";

export async function saveSchedule(ws: Workspace, input: Action<"schedule-save">) {
  const { source_id, frequency, scheduled_time, timezone, weekday, enabled } = input;
  await ws.source(source_id);
  let next_run_at: string;
  try { next_run_at = nextRun(input); }
  catch { throw new RequestError("Enter a valid timezone and schedule time."); }
  const id = input.id ?? randomUUID();
  const fields = { source_id, frequency, scheduled_time, timezone, weekday, enabled, next_run_at };
  if (input.id) {
    required(checked(await ws.row("backup_schedules", id)), "Schedule");
    checked(await ws.db.from("backup_schedules").update(fields).eq("user_id", ws.user).eq("id", id));
  } else {
    checked(await ws.db.from("backup_schedules").insert({ ...fields, id, user_id: ws.user }));
  }
  await ws.audit("schedule_save", "schedule", id);
  return { id };
}

export async function savePolicy(ws: Workspace, input: Action<"policy-save">) {
  const { name, source_id, keep_latest, daily, weekly, monthly, minimum, enabled } = input;
  await ws.source(source_id);
  const id = input.id ?? randomUUID();
  const fields = { name, source_id, enabled, retention_configuration: { keep_latest, daily, weekly, monthly, minimum } };
  if (input.id) {
    required(checked(await ws.row("retention_policies", id)), "Retention policy");
    checked(await ws.db.from("retention_policies").update(fields).eq("user_id", ws.user).eq("id", id));
  } else {
    checked(await ws.db.from("retention_policies").insert({ ...fields, id, user_id: ws.user }));
  }
  await ws.audit("policy_save", "policy", id);
  return { id };
}

export async function removeSetting(ws: Workspace, id: string, kind: "schedule" | "policy") {
  const table = kind === "schedule" ? "backup_schedules" : "retention_policies";
  required(checked(await ws.row(table, id)), kind === "schedule" ? "Schedule" : "Retention policy");
  checked(await ws.db.from(table).delete().eq("user_id", ws.user).eq("id", id));
  await ws.audit(`${kind}_delete`, kind, id);
  return { id };
}

export async function applyPolicy(ws: Workspace, id: string, preview: boolean) {
  const policy = required(checked(await ws.row("retention_policies", id)), "Retention policy");
  if (!preview && !policy.enabled) throw new RequestError("Enable the retention policy before applying it.", 409);
  const rows = checked(await ws.db.from("backups").select("*").eq("user_id", ws.user)
    .eq("source_id", policy.source_id).neq("status", "deleted").order("created_at", { ascending: false }).limit(1000)) ?? [];
  if (rows.length === 1000) throw new RequestError("This source exceeds the safe retention review limit.", 409);
  const ids = rows.map((row) => row.id);
  const passed = new Set<string>();
  // Keep the most recent verified point with a successful restore test.
  for (const row of rows.filter((item) => item.status === "verified")) {
    const tests = checked(await ws.db.from("restore_tests").select("id").eq("user_id", ws.user)
      .eq("backup_id", row.id).eq("status", "passed").limit(1));
    if (tests?.length) { passed.add(row.id); break; }
  }
  const plan = retentionPlan(rows.map((row) => ({ ...row, passed: passed.has(row.id) })), policy.retention_configuration);
  const deleted: string[] = [];
  if (!preview && ids.length) {
    for (const backupId of plan.remove.slice(0, 10)) {
      const candidate = rows.find((row) => row.id === backupId);
      if (!candidate) continue;
      const active = await Promise.all(["restore_tests", "restore_operations"].map(async (table) =>
        checked(await ws.db.from(table).select("id").eq("user_id", ws.user).eq("backup_id", backupId).eq("status", "running").limit(1))));
      if (active.some((items) => items?.length)) continue;
      checked(await ws.db.from("backups").update({ status: "deleting" }).eq("id", backupId).eq("user_id", ws.user));
      await ws.deleteObjects("backup-archives", [candidate.archive_path]);
      checked(await ws.db.from("backups").update({ status: "deleted" }).eq("id", backupId).eq("user_id", ws.user));
      await ws.audit("retention_delete", "backup", backupId, "success", { policy_id: id });
      deleted.push(backupId);
    }
  }
  return { id, ...plan, deleted, keep_count: plan.keep.length, delete_count: plan.remove.length };
}

export async function applySourcePolicy(ws: Workspace, sourceId: string) {
  const policy = checked(await ws.db.from("retention_policies").select("id").eq("source_id", sourceId)
    .eq("user_id", ws.user).eq("enabled", true).maybeSingle());
  if (policy) await applyPolicy(ws, policy.id, false);
}

type Schedule = { id: string; source_id: string; next_run_at: string; enabled: boolean } & Parameters<typeof nextRun>[0];

function scheduledId(scheduleId: string, due: string) {
  const digest = createHash("sha256").update(`${scheduleId}:${due}`).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export async function executeSchedule(ws: Workspace, id: string) {
  const row = checked(await ws.row("backup_schedules", id)) as Schedule | null;
  if (!row?.enabled || +new Date(row.next_run_at) > Date.now()) return { id, status: "skipped" };
  const operationId = scheduledId(id, row.next_run_at);
  let status: string;
  try {
    status = (await runBackup(ws, row.source_id, operationId)).status;
  } catch (error) {
    status = "failed";
    await ws.audit("schedule_run", "schedule", id, "failed", { job_id: operationId, error: safeError(error) });
  }
  const now = new Date();
  checked(await ws.db.from("backup_schedules").update({
    last_run_at: now.toISOString(), next_run_at: nextRun(row, now),
  }).eq("id", id).eq("user_id", ws.user));
  if (status === "success") await applySourcePolicy(ws, row.source_id);
  return { id, status };
}

export async function createDemo(ws: Workspace) {
  const previous = checked(await ws.db.from("backup_sources").select("id").eq("user_id", ws.user).eq("demo", true).neq("status", "deleted").limit(1));
  if (previous?.length) throw new RequestError("Demo records already exist. Reset them before running the demonstration again.", 409);
  const id = randomUUID();
  checked(await ws.db.from("backup_sources").insert({
    id, user_id: ws.user, name: "Field notes · fictional dataset", description: "Fictional files for the recovery demonstration.",
    storage_path: `${ws.user}/${id}`, demo: true, auto_test: true,
  }));
  await ws.audit("source_create", "source", id, "success", { demo: true });
  for (const input of [
    { path: "README.txt", body: "Fictional university demonstration dataset.\n" },
    { path: "observations/field-notes.csv", body: "sample,reading\nNorth,14\nSouth,18\n" },
    { path: "metadata/site.json", body: '{"site":"Sample Nature Reserve","fictional":true}\n' },
  ]) {
    const fileId = randomUUID();
    const path = `${ws.user}/${id}/${fileId}`;
    const data = Buffer.from(input.body, "utf8");
    if (data.length > ws.limits.maxFile) throw new RequestError("Configured storage limits are too low for this demo.", 413);
    checked(await ws.db.from("source_files").insert({
      id: fileId, user_id: ws.user, source_id: id, original_filename: input.path.split("/").at(-1),
      relative_path: input.path, storage_path: path, file_size: data.length, mime_type: "text/plain",
    }));
    await ws.putObject("source-files", path, data);
    checked(await ws.db.from("source_files").update({ status: "ready", sha256_checksum: sha256(data), uploaded_at: isoNow() })
      .eq("user_id", ws.user).eq("id", fileId));
    await ws.audit("file_upload", "file", fileId, "success", { demo: true, source_id: id, bytes: data.length });
  }
  const first = await runBackup(ws, id, randomUUID(), false);
  const verification = await verifyPoint(ws, first.id);
  const healthy = await runRestore(ws, first.id, undefined, "test", "demo");
  const badPoint = await makeCorruptedCopy(ws, first.id);
  const broken = await runRestore(ws, badPoint, undefined, "test", "demo");
  await ws.audit("demo_create", "source", id, "success", { demo: true, healthy_test: healthy.id, broken_test: broken.id });
  return { id, backup_id: first.id, verification: verification.status, healthy, broken };
}

export async function resetDemo(ws: Workspace) {
  const sources = checked(await ws.db.from("backup_sources").select("id,status").eq("user_id", ws.user).eq("demo", true)) ?? [];
  for (const source of sources) {
    const backups = checked(await ws.db.from("backups").select("id,archive_path").eq("user_id", ws.user).eq("source_id", source.id)) ?? [];
    for (const backup of backups) {
      const restores = checked(await ws.db.from("restore_operations").select("restore_destination,output_files").eq("user_id", ws.user).eq("backup_id", backup.id)) ?? [];
      for (const restore of restores) {
        const files = checked(await ws.db.storage.from("restored-files").list(restore.restore_destination, { limit: 500 })) ?? [];
        await ws.deleteObjects("restored-files", files.map((file) => `${restore.restore_destination}/${file.name}`));
      }
      await ws.deleteObjects("backup-archives", [backup.archive_path]);
    }
    if (source.status !== "deleted") await deleteSource(ws, source.id);
    checked(await ws.db.from("backup_sources").delete().eq("id", source.id).eq("user_id", ws.user).eq("demo", true));
    await ws.audit("demo_reset", "source", source.id);
  }
  return { removed: sources.length };
}
