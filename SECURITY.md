# Security

| Threat | Control | Residual exposure |
| --- | --- | --- |
| Cross-account access | Supabase session verification, owner-scoped API queries, table RLS, owner-scoped storage reads, private buckets | Service credential compromise bypasses RLS |
| Accidental deletion | Separate restore destinations, preserved source archive history, retention preview and minimum | A Supabase project owner can remove the project and its contents |
| Archive corruption | Stored-object checksum, ZIP structure and CRC, manifest and SHA-256 checks, actual test restores | Recovery needs a usable alternate point |
| Unsafe archive entries | Strict relative paths, collision checks, regular entries only, bounded reads and confined temporary writes | Browser filesystem metadata beyond path and contents is outside scope |
| Cryptographic key loss | Server-only AES-256-GCM, fresh random nonce per backup, authenticated envelope | Key loss makes encrypted backups unrecoverable |
| Incomplete writes | Storage re-read before transactional database finalization, unique request IDs and workspace lease | A function killed by the host can leave work pending until retry or cleanup |
| Storage exhaustion | File, source, archive and count limits, private signed upload reservations, retention | Provider quotas still apply across users and sources |
| Restore failure | Independent manifest validation, disk re-reads and stored output verification | Results apply to the point and deployment tested |

The database stores archive encryption version 1, with the nonce and tag in the artifact. Changing the configured key without migrating historical archives makes old encrypted points unreadable. Preserve the old key offline until the previous archives expire or are recovered and re-backed up under the new key. An operator should keep a protected key backup distinct from the archive storage.

The current architecture stores source and backup objects in the same Supabase project. It exercises recoverability from an application backup. Independent off-site or immutable storage is future work. File contents and access keys must stay out of application logs and screenshots.
