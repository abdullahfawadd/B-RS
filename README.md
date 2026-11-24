# Backup & Recovery System

A Next.js workspace for private file backups, integrity verification, isolated recovery, and automated restore testing. Backup creation, archive verification, and a successful test restore are tracked separately.

[Open the live application](https://b-rs.vercel.app)

## Run locally

Use Node.js 24 and npm. Create a dedicated Supabase project, run the SQL migration, and populate `.env.local` using `.env.example`. Then run:

```sh
npm install
npm run dev
```

Open http://localhost:3000. For the fastest walkthrough, run the fictional dataset in **Settings → Demonstration**. It creates a real archive, runs a restore test, and records a failure from a separately corrupted copy.

| Document | Contents |
| --- | --- |
| [Setup](SETUP.md) | Supabase, authentication, Vercel and cron |
| [User guide](USER_GUIDE.md) | Upload, backup, recover, verify and report |
| [Architecture](ARCHITECTURE.md) | Workflows, data model and operational boundaries |
| [Security](SECURITY.md) | Threat model, data isolation and key handling |
| [Testing](TESTING.md) | Verification commands and hosted test procedure |
| [Academic report](deliverables/Backup_and_Recovery_System_Report.docx) | Editable Word project report |

One deployment uses a shared Supabase database with per-user ownership and row-level security. All source files, archives and restored objects live in private buckets. The default limits are 10 MiB per file, 20 MiB per source, 30 MiB per archive and 100 source files.
