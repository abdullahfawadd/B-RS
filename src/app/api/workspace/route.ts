import { randomUUID } from "node:crypto";
import { checked, RequestError, withWorkspace } from "@/lib/workspace/core";
import { httpFailure, identity, requireOrigin, uncached, viewWorkspace } from "@/lib/workspace/http";
import { completeUploads, deleteFile, deleteSource, planUploads, saveSource } from "@/lib/workspace/sources";
import { runBackup, runRestore, verifyPoint } from "@/lib/workspace/operations";
import { applyPolicy, applySourcePolicy, createDemo, removeSetting, resetDemo, savePolicy, saveSchedule } from "@/lib/workspace/lifecycle";
import { workspaceAction } from "@/lib/workspace/validation";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try { return Response.json(await viewWorkspace(), { headers: uncached }); }
  catch (error) { return httpFailure(error); }
}

export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const { user } = await identity();
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      throw new RequestError("Send JSON for workspace operations.", 415);
    }
    if (Number(request.headers.get("content-length")) > 512_000) throw new RequestError("Request is too large.", 413);
    const raw = await request.text();
    if (raw.length > 512_000) throw new RequestError("Request is too large.", 413);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { throw new RequestError("Invalid JSON."); }
    const result = workspaceAction.safeParse(payload);
    if (!result.success) {
      const field = result.error.issues[0]?.path.join(".");
      throw new RequestError(field ? `Check the ${field.replaceAll("_", " ")} field.` : "Invalid workspace action.");
    }
    const input = result.data;
    const response = await withWorkspace(user.id, async (ws) => {
      switch (input.action) {
        case "source-save": return saveSource(ws, input);
        case "source-delete": return deleteSource(ws, input.id);
        case "upload-plan": return planUploads(ws, input);
        case "upload-complete": return completeUploads(ws, input);
        case "file-delete": return deleteFile(ws, input.id);
        case "backup": {
          const completed = await runBackup(ws, input.id, input.request_id);
          if (completed.status === "success") {
            try { await applySourcePolicy(ws, input.id); }
            catch { console.error("Retention deferred for a successful backup."); }
          }
          return completed;
        }
        case "verify": return verifyPoint(ws, input.id);
        case "restore": return runRestore(ws, input.id, input.request_id ?? randomUUID(), "restore");
        case "test": return runRestore(ws, input.id, input.request_id ?? randomUUID(), "test");
        case "schedule-save": return saveSchedule(ws, input);
        case "schedule-delete": return removeSetting(ws, input.id, "schedule");
        case "policy-save": return savePolicy(ws, input);
        case "policy-preview": return applyPolicy(ws, input.id, true);
        case "policy-run": return applyPolicy(ws, input.id, false);
        case "policy-delete": return removeSetting(ws, input.id, "policy");
        case "settings": {
          const { display_name, rpo_hours, rto_seconds } = input;
          checked(await ws.db.from("profiles").upsert({ id: user.id, email: user.email ?? "", display_name, rpo_hours, rto_seconds }));
          await ws.audit("settings_update", "profile", user.id);
          return { id: user.id };
        }
        case "demo": return createDemo(ws);
        case "demo-reset": return resetDemo(ws);
      }
    });
    return Response.json(response, { headers: uncached });
  } catch (error) { return httpFailure(error); }
}
