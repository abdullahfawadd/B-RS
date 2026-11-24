import { z } from "zod";
import { httpFailure, readWorkspace, uncached } from "@/lib/workspace/http";
import { checked, RequestError, required } from "@/lib/workspace/core";

const params = z.object({ id: z.uuid(), type: z.enum(["test", "backup"]) });

export async function GET(request: Request) {
  try {
    const query = params.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw new RequestError("Invalid report reference.");
    const { type, id } = query.data;
    const ws = await readWorkspace();
    const row = required(checked(await ws.row(type === "test" ? "restore_tests" : "backup_jobs", id)), "Report");
    const backup = checked(await ws.row("backups", type === "test" ? row.backup_id : id));
    return new Response(JSON.stringify({ type, record: row, backup }, null, 2), {
      headers: { ...uncached, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="brs-${type}-${id}.json"` },
    });
  } catch (error) { return httpFailure(error); }
}
