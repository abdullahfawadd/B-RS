import { timingSafeEqual } from "node:crypto";
import { isConfigured, serviceClient } from "@/lib/supabase/server";
import { checked, isoNow, RequestError, safeError, withWorkspace } from "@/lib/workspace/core";
import { executeSchedule } from "@/lib/workspace/lifecycle";
import { httpFailure, uncached } from "@/lib/workspace/http";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || !isConfigured()) throw new RequestError("Configure scheduler credentials first.", 503);
    const received = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new RequestError("Unauthorized scheduler request.", 401);
    }
    const started = Date.now();
    const due = checked(await serviceClient().from("backup_schedules").select("id,user_id")
      .eq("enabled", true).lte("next_run_at", isoNow()).order("next_run_at").limit(12)) ?? [];
    const results = [];
    for (const item of due) {
      const remaining = 49_000 - (Date.now() - started);
      if (remaining < 18_000) break;
      try { results.push(await withWorkspace(item.user_id, (ws) => executeSchedule(ws, item.id), remaining)); }
      catch (error) { results.push({ id: item.id, status: "deferred", error: safeError(error) }); }
    }
    return Response.json({ checked: due.length, results }, { headers: uncached });
  } catch (error) { return httpFailure(error); }
}
