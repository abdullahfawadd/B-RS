import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const capture = process.env.BRS_CAPTURE_SCREENSHOTS === "1";

function admin() {
  if (!url || !secret) throw new Error("Hosted test requires the isolated project's test configuration.");
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function user(db: SupabaseClient) {
  const email = `brs-qa-${randomUUID().slice(0, 12)}@example.com`;
  const password = randomBytes(22).toString("hex");
  const result = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (result.error || !result.data.user) throw new Error(result.error?.message ?? "Could not create QA user.");
  return { id: result.data.user.id, email, password };
}

async function signin(page: Page, email: string, password: string) {
  await page.goto("/signin");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/workspace/, { timeout: 30_000 });
}

async function removeFixture(db: SupabaseClient, id: string) {
  const [sourceFiles, backups, restores, jobs] = await Promise.all([
    db.from("source_files").select("storage_path").eq("user_id", id),
    db.from("backups").select("archive_path").eq("user_id", id),
    db.from("restore_operations").select("restore_destination,output_files").eq("user_id", id),
    db.from("backup_jobs").select("id").eq("user_id", id),
  ]);
  const files = (sourceFiles.data ?? []).map((row) => row.storage_path);
  const archives = [...new Set([...(backups.data ?? []).map((row) => row.archive_path), ...(jobs.data ?? []).map((row) => `${id}/${row.id}/archive.bin`)])];
  const restored = (restores.data ?? []).flatMap((row) => (row.output_files as { storage_path: string }[]).map((file) => file.storage_path));
  for (const [bucket, paths] of [["source-files", files], ["backup-archives", archives], ["restored-files", restored]] as const) {
    if (paths.length) {
      const result = await db.storage.from(bucket).remove(paths);
      if (result.error) throw result.error;
    }
  }
  const result = await db.auth.admin.deleteUser(id);
  if (result.error) throw result.error;
}

test("signed-out navigation, workspace API and cron reject unauthenticated use", async ({ page, request }) => {
  test.skip(!url || !publishable || !secret, "Requires Supabase test configuration");
  await page.goto("/workspace/sources");
  await expect(page).toHaveURL(/\/signin/);
  expect((await request.get("/api/workspace")).status()).toBe(401);
  expect((await request.get("/api/cron")).status()).toBe(401);
});

test("real private uploads, encrypted backup, restore, reports, scheduling and tenant isolation", async ({ page, browser, baseURL, request }) => {
  test.skip(!url || !publishable || !secret, "Requires Supabase test configuration");
  const db = admin();
  const owner = await user(db);
  const outsider = await user(db);
  const other = await browser.newContext({ baseURL });
  const post = (api: APIRequestContext, data: object, allowed = 200) => api.post("/api/workspace", {
    data, headers: { origin: baseURL! },
  }).then(async (reply) => {
    const json = await reply.json();
    expect(reply.status(), JSON.stringify(json)).toBe(allowed);
    return json;
  });
  try {
    await signin(page, owner.email, owner.password);
    const api = page.request;
    expect((await api.post("/api/workspace", { data: { action: "demo" }, headers: { origin: "https://example.com" } })).status()).toBe(403);
    const source = await post(api, { action: "source-save", name: "Qualitative research files", encryption_enabled: true, auto_test: true });
    const content = Buffer.from("participant,value\nFictional,12\n");
    const small = Buffer.from("This is a fictional QA study.\n");
    const plan = await post(api, { action: "upload-plan", source_id: source.id, files: [
      { path: "data/observations.csv", size: content.length, mime: "text/csv" },
      { path: "readme.txt", size: small.length, mime: "text/plain" },
    ] });
    const publicClient = createClient(url!, publishable!, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const slot of plan.uploads) {
      const reply = await publicClient.storage.from("source-files").uploadToSignedUrl(slot.storage_path, slot.token,
        slot.path.endsWith(".csv") ? content : small);
      expect(reply.error).toBeNull();
    }
    const ids = plan.uploads.map((slot: { id: string }) => slot.id);
    await post(api, { action: "upload-complete", source_id: source.id, ids });
    const requestId = randomUUID();
    const job = await post(api, { action: "backup", id: source.id, request_id: requestId });
    expect(job).toMatchObject({ id: requestId, status: "success", test_status: "passed" });
    expect(await post(api, { action: "backup", id: source.id, request_id: requestId })).toMatchObject({ id: requestId, status: "success" });
    expect(await post(api, { action: "verify", id: requestId })).toMatchObject({ status: "verified" });
    const restore = await post(api, { action: "restore", id: requestId, request_id: randomUUID() });
    expect(restore.status, restore.error).toBe("success");
    const restored = await api.get(`/api/download?id=${restore.id}&path=${encodeURIComponent("data/observations.csv")}`);
    expect(restored.ok()).toBeTruthy();
    expect(await restored.body()).toEqual(content);
    const tested = await post(api, { action: "test", id: requestId, request_id: randomUUID() });
    expect(tested.status).toBe("passed");
    const report = await api.get(`/api/report?type=test&id=${tested.id}`);
    const reportData = await report.json();
    expect(report.headers()["content-disposition"]).toContain("attachment");
    expect(reportData.record).toMatchObject({ status: "passed", files_tested: 2, files_verified: 2, failed_files: 0, bytes_restored: content.length + small.length });
    expect(reportData.backup.manifest.files).toContainEqual({ path: "data/observations.csv", size: content.length, sha256: createHash("sha256").update(content).digest("hex") });
    const schedule = await post(api, { action: "schedule-save", source_id: source.id, frequency: "daily", scheduled_time: "09:00", timezone: "Asia/Karachi", enabled: true });
    expect(schedule.id).toBeTruthy();

    const otherPage = await other.newPage();
    await signin(otherPage, outsider.email, outsider.password);
    const outsiderState = await (await otherPage.request.get("/api/workspace")).json();
    expect(outsiderState.sources).toEqual([]);
    const unauthorized = await post(otherPage.request, { action: "restore", id: requestId }, 404);
    expect(unauthorized.error).toContain("not found");
    expect((await otherPage.request.get(`/api/report?type=test&id=${tested.id}`)).status()).toBe(404);
    const outsiderClient = createClient(url!, publishable!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await outsiderClient.auth.signInWithPassword(outsider)).error).toBeNull();
    expect((await outsiderClient.from("backup_sources").select("id").eq("id", source.id)).data).toEqual([]);
    expect((await outsiderClient.storage.from("source-files").download(plan.uploads[0].storage_path)).error).not.toBeNull();
    expect((await outsiderClient.from("audit_logs").insert({ user_id: outsider.id, operation: "backup", resource_type: "backup", status: "success" })).error).not.toBeNull();

    const policy = await post(api, { action: "policy-save", source_id: source.id, name: "Keep the newest verified copy", keep_latest: 1, daily: 0, weekly: 0, monthly: 0, minimum: 1, enabled: false });
    const preview = await post(api, { action: "policy-preview", id: policy.id });
    expect(preview.keep).toContain(requestId);
    expect(preview.remove).toEqual([]);
    if (process.env.CRON_SECRET && !process.env.BRS_E2E_URL) {
      expect((await db.from("backup_schedules").update({ next_run_at: "2020-01-01T00:00:00Z" }).eq("id", schedule.id)).error).toBeNull();
      const check = await request.get("/api/cron", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
      expect(check.status()).toBe(200);
      expect((await check.json()).results).toContainEqual(expect.objectContaining({ id: schedule.id, status: "success" }));
    }
    const demo = await post(api, { action: "demo" });
    expect(demo.healthy.status).toBe("passed");
    expect(demo.broken.status).toBe("failed");
    await post(api, { action: "upload-plan", source_id: demo.id, files: [{ path: "ordinary-file.txt", size: 1 }] }, 409);
    const broken = await (await api.get(`/api/report?type=test&id=${demo.broken.id}`)).json();
    expect(broken.record.error_message.toLowerCase()).toMatch(/checksum|integrity/);

    await page.goto("/workspace");
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
    if (capture) {
      await mkdir("docs/screenshots", { recursive: true });
      await mkdir(".qa", { recursive: true });
      await writeFile(".qa/restore-report.json", JSON.stringify(reportData, null, 2));
      await writeFile(".qa/corrupted-report.json", JSON.stringify(broken, null, 2));
      for (const [section, name] of [["", "overview"], ["/testing", "restore-testing"], ["/sources", "sources"], ["/test-history", "restore-test-history"]]) {
        await page.goto(`/workspace${section}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.getByText(owner.email, { exact: true }).first()).toBeAttached();
        await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: true, animations: "disabled" });
      }
    }
    await post(api, { action: "demo-reset" });
    const remaining = await (await api.get("/api/workspace")).json();
    expect(remaining.sources).toContainEqual(expect.objectContaining({ id: source.id }));
    expect(remaining.sources.some((row: { demo: boolean }) => row.demo)).toBe(false);
    const newest = await post(api, { action: "backup", id: source.id });
    expect(newest.status).toBe("success");
    await post(api, { action: "policy-save", id: policy.id, source_id: source.id, name: "Keep the newest verified copy", keep_latest: 1, daily: 0, weekly: 0, monthly: 0, minimum: 1, enabled: true });
    const cleanup = await post(api, { action: "policy-run", id: policy.id });
    expect(cleanup.keep).toContain(newest.id);
    expect(cleanup.deleted).toContain(requestId);
    await post(api, { action: "verify", id: requestId }, 404);
    expect((await api.get(`/api/download?id=${restore.id}&path=${encodeURIComponent("data/observations.csv")}`)).ok()).toBeTruthy();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/signin/);
    expect((await api.get("/api/workspace")).status()).toBe(401);
  } finally {
    await other.close();
    await removeFixture(db, outsider.id);
    await removeFixture(db, owner.id);
  }
});
