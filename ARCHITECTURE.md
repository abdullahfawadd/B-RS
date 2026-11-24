# Architecture

The browser talks to Next.js for authenticated metadata and operations. Upload content goes directly to a per-file signed Supabase Storage URL. The server validates metadata, checks ownership, performs bounded processing in Node.js and coordinates PostgreSQL and the private buckets. Expiring per-user leases serialize mutating actions. Vercel Cron invokes the same backup operation for due schedules.

```mermaid
flowchart LR
  B[Browser] --> N[Next.js App Router]
  B -->|Signed upload| S[Private Supabase Storage]
  N --> A[Supabase Auth]
  N --> P[(PostgreSQL metadata and RLS)]
  N --> S
  C[Vercel Cron] --> N
  N --> T[Isolated temporary filesystem]
```

```mermaid
flowchart LR
  A[Read finalized files] --> B[Check source SHA-256] --> C[Create ZIP and manifest]
  C --> D[Optionally encrypt with AES-GCM] --> E[Upload and re-read]
  E --> F[Verify archive and entries] --> G[Finalize job and backup in PostgreSQL]
```

```mermaid
flowchart LR
  A[Select recovery point] --> B[Verify archive and manifest] --> C[Restore to isolated temporary directory]
  C --> D[Read files back and verify] --> E[Write private restore destination]
  E --> F[Verify stored outputs] --> G[Issue short-lived download links]
```

```mermaid
flowchart LR
  A[Manual request or post-backup trigger] --> B[Shared restore pipeline]
  B --> C[Verify reconstructed files and measure time] --> D[Clean temporary directory]
  D --> E[Save test result and per-file detail]
```

```mermaid
erDiagram
  USERS ||--o| PROFILES : has
  USERS ||--o{ BACKUP_SOURCES : owns
  USERS ||--o{ AUDIT_LOGS : owns
  BACKUP_SOURCES ||--o{ SOURCE_FILES : contains
  BACKUP_SOURCES ||--o{ BACKUP_SCHEDULES : schedules
  BACKUP_SOURCES ||--o{ BACKUP_JOBS : processes
  BACKUP_SOURCES ||--o{ BACKUPS : retains
  BACKUP_SOURCES ||--o| RETENTION_POLICIES : governs
  BACKUP_JOBS ||--o| BACKUPS : produces
  BACKUPS ||--o{ RESTORE_TESTS : tests
  BACKUPS ||--o{ RESTORE_OPERATIONS : restores
```

The ZIP contains a versioned manifest of relative paths, sizes and SHA-256 values. The stored checksum is computed over the exact object, which may be an authenticated encrypted envelope. The verification pipeline also compares the internal manifest against the database copy. Restore tests re-read actual reconstructed files from a private temporary directory and discard the directory in a finally block.
