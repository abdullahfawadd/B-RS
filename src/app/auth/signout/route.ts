import { NextResponse } from "next/server";
import { sessionClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) return new Response("Invalid origin", { status: 403 });
  const client = await sessionClient();
  await client.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/signin", url), 303);
}
