# Build sequence

1. Configure the single Next.js workspace, Supabase server session handling, and private storage.
2. Implement the archive pipeline with a bounded manifest, authenticated encryption, verification, and isolated restore. Exercise it with synthetic files and actual on-disk reads.
3. Add ownership-scoped workspace operations, result persistence, retries, schedules, and guarded retention.
4. Wire the workspace views to PostgreSQL state and signed direct uploads.
5. Verify migrations, test the healthy and corrupted cases, capture evidence, and produce the editable report.
