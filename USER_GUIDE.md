# User guide

1. Sign in and open **Backup Sources**. Create a named source. Enable automatic restore tests and optional encryption when the server key has been configured.
2. Add files with the file picker, drag and drop, or a supported directory picker. The source lists file sizes and recorded SHA-256 digests. A file that has not finished verification remains pending. A backup uses finalized source files.
3. Run a backup for the source. **Backup Jobs** records processing status. **Backup History** lists completed archives and integrity results.
4. In **Recovery Points**, inspect a manifest or request a verification. In **Restore Operations**, restore a selected point into private storage. Download individual files from the result. Restoration always uses a new destination.
5. In **Restore Testing**, run a test on demand. With automatic testing enabled, a successful backup also starts a test. **Restore Test History** records restored and verified files, bytes, timing and errors. **Reports** downloads JSON records.
6. In **Settings**, configure RPO and RTO targets. RPO is the maximum acceptable age of a recovery point. RTO is the acceptable recovery duration. Actual measurements depend on recorded recovery points and completed restore evidence.
7. Set daily or weekly scheduling for a source if the deployment has cron configured. When using Hobby, the next scheduled time is when work becomes due for the daily sweep.
8. Create a source-specific retention policy and preview its keep and delete counts. Auto cleanup runs with successful backups. Deletion preserves a minimum of integrity-verified points and the newest verified point with a passed test.
9. Use **Audit Logs** to review workspace actions and outcomes. The demonstration creates a separate fictional source, a healthy archive and a corrupted copy. Its reset acts on demonstration data.

Source deletion removes the active uploaded files and disables its schedules. Existing backup records and archives remain available according to retention.
