# Setup and deployment

## Supabase

1. Create a Supabase project dedicated to B‑RS. Set a strong database password and choose a region close to your Vercel function.
2. In the Supabase SQL Editor, run the SQL files under `supabase/migrations/` once in filename order. For CLI-managed deployments, use `supabase link --project-ref YOUR_PROJECT_REF` and `supabase db push` from the repository. The migration creates the data tables, row-level policies, restricted service functions and three private buckets. No Docker process is required.
3. Under **Connect** or **Settings → API Keys**, copy the Project URL, publishable key and server-only secret key.
4. In **Authentication → URL Configuration**, set the production Site URL and allow `https://YOUR_DOMAIN/auth/callback` and `http://localhost:3000/auth/callback` as redirect URLs. Keep email confirmation enabled for a public deployment. Configure custom SMTP for a public signup audience because Supabase's default mail service has restricted delivery. A demo evaluator can use an account provisioned through the project's Auth dashboard.
5. Copy `.env.example` to `.env.local`. Set the project URL, keys and application URL. Generate each of the encryption and cron secrets independently with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Store the encryption key in a protected password manager. Keep these values out of Git.
6. Run `npm install` and `npm run dev`. Check the sign-in page at http://localhost:3000. Successful sign-in opens the protected workspace.

Storage hard caps in the migration and plan limits still apply when increasing app limits. Review Vercel function memory and duration before increasing them. B‑RS keeps each bounded workload in function memory and temporary storage during processing.

## Vercel

1. Push the repository to GitHub and import it as a Next.js project in Vercel.
2. Set Node.js to 24.x. Add each environment variable from `.env.example` to Production, with `NEXT_PUBLIC_APP_URL` set to the stable HTTPS domain. Mark the Supabase service key, encryption key and cron secret as sensitive. Preview environments need their own configuration if they are used with a separate project.
3. Deploy and add the production URL and callback URL to Supabase Auth. Check signup/confirmation and sign-in with a disposable account.
4. `vercel.json` registers `GET /api/cron` once daily at 00:00 UTC. Vercel sends `Authorization: Bearer <CRON_SECRET>` when the environment variable is configured. Cron uses the production deployment. Hobby dispatch can occur within the scheduled hour. User-local times are due thresholds and a backup starts at a sweep after it becomes due. Pending schedules beyond the processing budget wait for a later sweep.
5. Verify a private upload, create a backup, inspect its manifest, run a restore test, restore the files into a separate destination and download one. For the failure case, use the fictional demonstration and view its failed test.

To check schedules more frequently, use Vercel Pro with an appropriate cron expression or a trusted scheduling service calling the same HTTPS endpoint with its bearer secret. Confirm the behavior and plan limits before changing the schedule. [Vercel cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
