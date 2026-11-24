import { z } from "zod";

const uuid = z.uuid();
const text = z.string().trim().min(1).max(100);
const requestId = uuid.optional();
const enabled = z.boolean().default(true);

export const workspaceAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("source-save"), id: uuid.optional(), name: text, description: z.string().trim().max(1000).default(""), auto_test: z.boolean().default(true), encryption_enabled: z.boolean().default(false) }),
  z.object({ action: z.literal("source-delete"), id: uuid }),
  z.object({ action: z.literal("upload-plan"), source_id: uuid, files: z.array(z.object({ path: z.string().min(1).max(512), size: z.number().int().nonnegative().max(50_000_000), mime: z.string().max(200).default("application/octet-stream") })).min(1).max(500) }),
  z.object({ action: z.literal("upload-complete"), source_id: uuid, ids: z.array(uuid).min(1).max(500), checksums: z.record(uuid, z.string().regex(/^[0-9a-f]{64}$/)).optional() }),
  z.object({ action: z.literal("file-delete"), id: uuid }),
  z.object({ action: z.literal("backup"), id: uuid, request_id: requestId }),
  z.object({ action: z.literal("verify"), id: uuid, request_id: requestId }),
  z.object({ action: z.literal("restore"), id: uuid, request_id: requestId }),
  z.object({ action: z.literal("test"), id: uuid, request_id: requestId }),
  z.object({ action: z.literal("schedule-save"), id: uuid.optional(), source_id: uuid, frequency: z.enum(["daily", "weekly"]), scheduled_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/), timezone: z.string().min(1).max(80), enabled, weekday: z.number().int().min(0).max(6).default(1) }),
  z.object({ action: z.literal("schedule-delete"), id: uuid }),
  z.object({ action: z.literal("policy-save"), id: uuid.optional(), name: text, source_id: uuid, keep_latest: z.number().int().min(1).max(100), daily: z.number().int().min(0).max(365), weekly: z.number().int().min(0).max(104), monthly: z.number().int().min(0).max(60), minimum: z.number().int().min(1).max(100), enabled }),
  z.object({ action: z.literal("policy-preview"), id: uuid }),
  z.object({ action: z.literal("policy-run"), id: uuid }),
  z.object({ action: z.literal("policy-delete"), id: uuid }),
  z.object({ action: z.literal("settings"), display_name: z.string().trim().max(100), rpo_hours: z.number().int().min(1).max(8760), rto_seconds: z.number().int().min(1).max(86400) }),
  z.object({ action: z.literal("demo") }),
  z.object({ action: z.literal("demo-reset") }),
]);

export type WorkspaceAction = z.infer<typeof workspaceAction>;
export type Action<T extends WorkspaceAction["action"]> = Extract<WorkspaceAction, { action: T }>;
