# Testing

Use Node.js 24.

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
node node_modules/@playwright/test/cli.js install chromium
npm run test:e2e
```

Vitest exercises the archive engine with fictional files and temporary directories. It checks stored checksums, compression, nested paths, encrypted round trips, limits, changed artifacts, malformed manifests and cleanup. Scheduling tests cover timezone offsets and daylight saving transitions. Retention tests verify minimum points and calendar selection.

Playwright uses the configured **dedicated test Supabase project**. It creates two disposable users and removes their records and storage after the test. The test exercises real signed upload, encrypted backup, idempotency, verification, private restore and download, a passed restore test, report export, scheduler authorization, tenant isolation and the corrupted-copy demonstration. It creates fictional files only. Use `BRS_E2E_URL` to direct it at a deployed application that uses the same isolated backend and credentials.

Set `BRS_CAPTURE_SCREENSHOTS=1` to capture the real workspace pages under `docs/screenshots/` and write raw synthetic test evidence to the ignored `.qa/` directory. Screenshot data contains fictional test records.

## Verified release

| Check | Result |
| --- | --- |
| ESLint, strict TypeScript and production build | Passed |
| Vitest | 32 passed across archive, restore, scheduling and retention |
| Playwright against Vercel and the dedicated Supabase project | 2 passed with real storage and records |
| Authorized due-schedule execution | Passed in the local app against hosted Supabase |
| Mobile Chromium browser flow | Private upload, backup and automatic test verified at 390 × 844 |

In the production capture, the manual test verified two files totaling 61 bytes in 78 ms. The separate corrupted archive failed the checksum precheck and verified zero files. The production workflow also exercised scoped demo reset, retention deletion, continued download access to a previously restored file, and sign-out. Those measurements describe this fictional fixture.
