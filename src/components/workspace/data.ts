export type Row = {
  id: string;
  status?: string;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
};

export type Source = Row & { name: string; description?: string; auto_test: boolean; encryption_enabled: boolean; demo?: boolean; updated_at?: string };
export type SourceFile = Row & { source_id: string; original_filename: string; relative_path?: string; file_size: number; sha256_checksum?: string; mime_type?: string; uploaded_at?: string };
export type Job = Row & { source_id: string; duration_ms?: number };
export type ManifestFile = { path: string; size: number; sha256: string };
export type Backup = Row & { source_id: string; backup_job_id: string; name: string; original_size: number; compressed_size: number; checksum: string; manifest?: { files: ManifestFile[] }; encryption_enabled: boolean; verified_at?: string; demo_corrupt?: boolean };
export type Restore = Row & { backup_id: string; restore_destination: string; files_restored: number; bytes_restored: number; duration_ms?: number; output_files?: (ManifestFile & { storage_path: string })[] };
export type RestoreTest = Row & { backup_id: string; files_tested: number; files_verified: number; failed_files: number; bytes_restored: number; duration_ms?: number; restore_duration_ms?: number; verification_duration_ms?: number; verification_details?: unknown[]; trigger?: string };
export type Schedule = Row & { source_id: string; frequency: string; scheduled_time: string; timezone: string; enabled: boolean; weekday?: number; next_run_at?: string; last_run_at?: string };
export type Policy = Row & { name: string; source_id?: string; keep_latest?: number; daily?: number; weekly?: number; monthly?: number; minimum?: number; enabled: boolean; retention_configuration?: { source_id?: string; keep_latest?: number; daily?: number; weekly?: number; monthly?: number; minimum?: number } };
export type Audit = Row & { operation: string; resource_type: string; resource_id?: string; details?: Record<string, unknown> };
export type WorkspaceData = {
  email: string;
  profile: { display_name?: string; rpo_hours?: number; rto_seconds?: number } | null;
  sources: Source[];
  files: SourceFile[];
  jobs: Job[];
  backups: Backup[];
  restores: Restore[];
  tests: RestoreTest[];
  schedules: Schedule[];
  policies: Policy[];
  audit: Audit[];
  limits: { maxFile: number; maxSource: number; maxArchive: number; maxFiles: number };
};

export type Action = (action: string, fields?: Record<string, unknown>, message?: string) => Promise<Record<string, unknown>>;

export const display = (value?: string) => value ? value.replace(/[_-]/g, " ").replace(/^\w/, (letter) => letter.toUpperCase()) : "Pending";
export const shortId = (value: string) => value.slice(0, 8);
export const backupName = (data: WorkspaceData, id: string) => data.backups.find((backup) => backup.id === id)?.name || shortId(id);
export const sourceName = (data: WorkspaceData, id?: string) => data.sources.find((source) => source.id === id)?.name || (id ? "Archived source" : "All sources");
export const timeOf = (row?: Partial<Row>) => row?.completed_at ?? row?.started_at ?? row?.created_at;
export const newest = <T extends Row>(rows: T[]) => [...rows].sort((a, b) => (timeOf(b) ?? "").localeCompare(timeOf(a) ?? ""));
export const isSuccess = (value?: string) => ["completed", "success", "successful", "succeeded", "ready", "passed", "verified"].includes(value ?? "");
export const isFailed = (value?: string) => ["failed", "error", "corrupted", "missing"].includes(value ?? "");
export const failedCount = (test: RestoreTest) => test.failed_files ?? 0;
export const isAvailable = (backup: Backup) => !["deleted", "deleting"].includes(backup.status ?? "");
export const isVerified = (backup: Backup) => backup.status === "verified";
export const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
export const dateOnly = (value?: string) => value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value)) : "—";

export function bytes(value?: number) {
  const amount = Number(value ?? 0);
  if (amount < 1024) return `${amount} B`;
  const unit = Math.min(Math.floor(Math.log(amount) / Math.log(1024)), 4);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(amount / 1024 ** unit)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}

export function duration(value?: number | null) {
  if (value == null) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(1)} s`;
  if (value < 3600000) return `${(value / 60000).toFixed(1)} min`;
  return `${(value / 3600000).toFixed(1)} hr`;
}
export const sections = ["overview", "sources", "jobs", "backups", "recovery", "restores", "testing", "test-history", "retention", "reports", "audit", "settings"] as const;
export type Section = typeof sections[number];
