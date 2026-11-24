import { z } from "zod";
import { restoredFile } from "@/lib/workspace/operations";
import { httpFailure, readWorkspace, uncached } from "@/lib/workspace/http";
import { RequestError } from "@/lib/workspace/core";

const params = z.object({ id: z.uuid(), path: z.string().min(1).max(512) });

export async function GET(request: Request) {
  try {
    const query = params.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw new RequestError("Invalid file reference.");
    const ws = await readWorkspace();
    const url = await restoredFile(ws, query.data.id, query.data.path);
    return new Response(null, { status: 303, headers: { ...uncached, Location: url, "Referrer-Policy": "no-referrer" } });
  } catch (error) { return httpFailure(error); }
}
