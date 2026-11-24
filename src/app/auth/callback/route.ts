import { NextResponse } from "next/server";
import { sessionClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const client = await sessionClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/workspace", url));
  }
  return NextResponse.redirect(new URL("/signin?message=The+confirmation+could+not+be+completed.+Try+signing+in.", url));
}
