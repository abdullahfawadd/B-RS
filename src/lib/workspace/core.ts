import "server-only";
import { randomUUID } from "node:crypto";
import { configuredLimits } from "@/lib/config";
import { serviceClient, type ServiceClient } from "@/lib/supabase/server";

export class RequestError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) {
    super(message);
  }
}

export function checked<T>({ data, error }: { data: T; error: { message: string; code?: string } | null }): T {
  if (error) {
    if (error.code === "23505") throw new RequestError("That record already exists.", 409);
    console.error("Workspace data operation failed", { code: error.code ?? "unknown" });
    throw new RequestError("The workspace could not complete the operation. Please try again.", 502);
  }
  return data;
}

export function required<T>(data: T | null, name: string): T {
  if (data === null) throw new RequestError(`${name} was not found.`, 404);
  return data;
}

export const isoNow = () => new Date().toISOString();
export const elapsed = (start: number) => Math.max(0, Math.round(performance.now() - start));

export function safeError(error: unknown): string {
  return error instanceof RequestError ? error.message : "The operation could not be completed.";
}

export function encryptionKey(enabled: boolean): Buffer | undefined {
  if (!enabled) return undefined;
  const value = process.env.BACKUP_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new RequestError("The server needs the original 32-byte backup encryption key.", 503, "key");
  }
  return Buffer.from(value, "hex");
}

export class Workspace {
  readonly limits = configuredLimits();

  constructor(readonly db: ServiceClient, readonly user: string, readonly signal: AbortSignal) {}

  row(table: string, id: string) {
    return this.db.from(table).select("*").eq("id", id).eq("user_id", this.user).maybeSingle();
  }

  async source(id: string, allowDeleting = false) {
    const source = required(checked(await this.row("backup_sources", id)), "Source");
    if (source.status !== "active" && !(allowDeleting && source.status === "deleting")) {
      throw new RequestError("Source was not found.", 404);
    }
    return source;
  }

  async recoveryPoint(id: string) {
    const point = required(checked(await this.row("backups", id)), "Recovery point");
    if (point.status === "deleted" || point.status === "deleting") {
      throw new RequestError("Recovery point was not found.", 404);
    }
    return point;
  }

  async audit(operation: string, resource: string, id: string | null, status = "success", details: object = {}) {
    checked(await this.db.from("audit_logs").insert({
      user_id: this.user, operation, resource_type: resource, resource_id: id, status, details,
    }));
  }

  async getObject(bucket: string, path: string, max: number): Promise<Buffer> {
    this.signal.throwIfAborted();
    if (!path.startsWith(`${this.user}/`)) throw new RequestError("Invalid storage ownership.", 403);
    const { data, error } = await this.db.storage.from(bucket).download(path);
    if (error) {
      const storageError = error as unknown as { status?: number; statusCode?: string | number };
      const status = Number(storageError.status ?? storageError.statusCode);
      if (status === 404 || /not found/i.test(error.message)) throw new RequestError("Storage object is missing.", 404, "missing");
      throw new RequestError("Storage could not read the object.", 502);
    }
    if (data.size > max) throw new RequestError("Stored object exceeds the configured size limit.", 413, "limit");
    return Buffer.from(await data.arrayBuffer());
  }

  async putObject(bucket: string, path: string, buffer: Buffer) {
    this.signal.throwIfAborted();
    if (!path.startsWith(`${this.user}/`)) throw new RequestError("Invalid storage ownership.", 403);
    checked(await this.db.storage.from(bucket).upload(path, buffer, { contentType: "application/octet-stream", upsert: false }));
  }

  async deleteObjects(bucket: string, paths: string[]) {
    if (!paths.length) return;
    if (paths.some((path) => !path.startsWith(`${this.user}/`))) {
      throw new RequestError("Invalid storage ownership.", 403);
    }
    for (let offset = 0; offset < paths.length; offset += 100) {
      checked(await this.db.storage.from(bucket).remove(paths.slice(offset, offset + 100)));
    }
  }
}

export async function withWorkspace<T>(user: string, operation: (workspace: Workspace) => Promise<T>, timeout = 48_000): Promise<T> {
  const token = randomUUID();
  const cleanupDb = serviceClient();
  const signal = AbortSignal.timeout(timeout);
  const db = serviceClient(signal);
  const acquired = checked(await db.rpc("acquire_workspace_lease", { p_user: user, p_token: token }));
  if (!acquired) throw new RequestError("Another workspace operation is running. Try again shortly.", 409);
  try {
    return await operation(new Workspace(db, user, signal));
  } finally {
    const { error } = await cleanupDb.from("workspace_leases").delete().eq("user_id", user).eq("token", token);
    if (error) console.error("Workspace lease release failed", { code: error.code });
  }
}
