import "server-only";
import { isConfigured, serviceClient, sessionClient } from "@/lib/supabase/server";
import { checked, RequestError, Workspace } from "./core";
import { configuredLimits } from "@/lib/config";

export const uncached = { "Cache-Control": "private, no-store" };

export async function identity() {
  if (!isConfigured()) throw new RequestError("Connect Supabase to begin using this workspace.", 503, "setup");
  const client = await sessionClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new RequestError("Sign in to open this workspace.", 401);
  return { user: data.user, client };
}

export async function viewWorkspace() {
  const { user, client } = await identity();
  const [profile, sources, files, jobs, backups, restores, tests, schedules, policies, audit] = await Promise.all([
    client.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    client.from("backup_sources").select("*").neq("status", "deleted").order("created_at", { ascending: false }),
    client.from("source_files").select("*").order("created_at", { ascending: false }),
    client.from("backup_jobs").select("*").order("created_at", { ascending: false }),
    client.from("backups").select("*").not("status", "in", "(deleted,deleting)").order("created_at", { ascending: false }),
    client.from("restore_operations").select("*").order("started_at", { ascending: false }),
    client.from("restore_tests").select("*").order("started_at", { ascending: false }),
    client.from("backup_schedules").select("*").order("next_run_at"),
    client.from("retention_policies").select("*").order("created_at", { ascending: false }),
    client.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(1000),
  ]);
  return {
    email: user.email ?? "",
    profile: checked(profile) ?? { id: user.id, email: user.email ?? "", display_name: "", rpo_hours: 24, rto_seconds: 60 },
    sources: checked(sources) ?? [], files: checked(files) ?? [],
    jobs: checked(jobs) ?? [], backups: checked(backups) ?? [],
    restores: checked(restores) ?? [], tests: checked(tests) ?? [], schedules: checked(schedules) ?? [],
    policies: checked(policies) ?? [], audit: checked(audit) ?? [],
    limits: configuredLimits(),
  };
}

export function httpFailure(error: unknown) {
  if (error instanceof RequestError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: uncached });
  }
  console.error("Workspace request failed", { name: error instanceof Error ? error.name : "unknown" });
  return Response.json({ error: "The request could not be completed. Check workspace status before retrying." }, { status: 500, headers: uncached });
}

export async function readWorkspace() {
  const { user } = await identity();
  const signal = AbortSignal.timeout(12_000);
  return new Workspace(serviceClient(signal), user.id, signal);
}

export function requireOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || (origin !== new URL(request.url).origin && origin !== process.env.NEXT_PUBLIC_APP_URL)) {
    throw new RequestError("Invalid request origin.", 403);
  }
}
