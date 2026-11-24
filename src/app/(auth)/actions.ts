"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { isConfigured, sessionClient } from "@/lib/supabase/server";

const form = z.object({ email: z.email().max(254), password: z.string().min(8).max(128) });

export async function authenticate(mode: "signin" | "signup", input: FormData) {
  if (!isConfigured()) redirect("/workspace");
  const parsed = form.safeParse(Object.fromEntries(input));
  if (!parsed.success) redirect(`/${mode}?message=Enter+a+valid+email+and+at+least+8+password+characters.`);
  const client = await sessionClient();
  if (mode === "signup") {
    const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const result = await client.auth.signUp({ ...parsed.data, options: { emailRedirectTo: new URL("/auth/callback", origin).href } });
    if (result.error) redirect("/signup?message=Could+not+create+the+account.+Please+try+again.");
    if (!result.data.session) redirect("/signin?message=Check+your+email+to+confirm+your+account.");
  } else {
    const result = await client.auth.signInWithPassword(parsed.data);
    if (result.error) redirect("/signin?message=Sign-in+failed.+Check+your+credentials+and+email+confirmation.");
  }
  redirect("/workspace");
}
