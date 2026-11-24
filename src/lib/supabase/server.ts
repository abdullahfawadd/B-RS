import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { publishableKey, supabaseUrl } from "@/lib/config";

export function isConfigured() {
  return Boolean(supabaseUrl && publishableKey && process.env.SUPABASE_SECRET_KEY);
}

export async function sessionClient() {
  if (!supabaseUrl || !publishableKey) throw new Error("Supabase URL and publishable key are required.");
  const jar = await cookies();
  return createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (items) => {
        try { items.forEach(({ name, value, options }) => jar.set(name, value, options)); }
        catch { /* The proxy refreshes cookies for Server Components. */ }
      },
    },
  });
}

export function serviceClient(signal?: AbortSignal) {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !key) throw new Error("Supabase service configuration is missing.");
  return createClient(supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => {
      const signals = [AbortSignal.timeout(15_000), signal, init?.signal].filter((item): item is AbortSignal => Boolean(item));
      return fetch(input, { ...init, signal: AbortSignal.any(signals) });
    } },
  });
}

export type ServiceClient = ReturnType<typeof serviceClient>;
