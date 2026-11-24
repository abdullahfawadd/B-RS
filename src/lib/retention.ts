export type RetentionConfig = { keep_latest: number; daily: number; weekly: number; monthly: number; minimum: number };
export type RecoveryCandidate = { id: string; created_at: string; status: string; passed?: boolean };

const day = 86_400_000;
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const monday = (date: Date) => {
  const midnight = new Date(`${dateKey(date)}T00:00:00Z`);
  return new Date(+midnight - ((midnight.getUTCDay() + 6) % 7) * day);
};

export function retentionPlan(rows: RecoveryCandidate[], rules: RetentionConfig, date = new Date()) {
  const verified = rows.filter((row) => row.status === "verified").sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  const keep = new Set(verified.slice(0, Math.max(rules.keep_latest, rules.minimum)).map((row) => row.id));
  const lastTested = verified.find((row) => row.passed);
  if (lastTested) keep.add(lastTested.id);
  const buckets = new Set<string>();
  for (const row of verified) {
    const point = new Date(row.created_at);
    const monthAge = (date.getUTCFullYear() - point.getUTCFullYear()) * 12 + date.getUTCMonth() - point.getUTCMonth();
    const candidates = [
      { age: Math.floor((+new Date(dateKey(date)) - +new Date(dateKey(point))) / day), count: rules.daily, key: `d:${dateKey(point)}` },
      { age: (+monday(date) - +monday(point)) / (7 * day), count: rules.weekly, key: `w:${dateKey(monday(point))}` },
      { age: monthAge, count: rules.monthly, key: `m:${dateKey(point).slice(0, 7)}` },
    ];
    for (const bucket of candidates) {
      if (bucket.age >= 0 && bucket.age < bucket.count && !buckets.has(bucket.key)) {
        buckets.add(bucket.key);
        keep.add(row.id);
      }
    }
  }
  return {
    keep: rows.filter((row) => row.status !== "deleting" && row.status !== "deleted" && (row.status !== "verified" || keep.has(row.id))).map((row) => row.id),
    remove: [...rows.filter((row) => row.status === "deleting"), ...verified.filter((row) => !keep.has(row.id))].map((row) => row.id),
  };
}
