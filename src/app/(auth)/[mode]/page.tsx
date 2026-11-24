import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DatabaseBackup, Fingerprint, ShieldCheck } from "lucide-react";
import { authenticate } from "../actions";
import { isConfigured } from "@/lib/supabase/server";
import styles from "../auth.module.css";

export default async function AuthPage({ params, searchParams }: {
  params: Promise<{ mode: string }>;
  searchParams: Promise<{ message?: string }>;
}) {
  const { mode } = await params;
  if (mode !== "signin" && mode !== "signup") notFound();
  if (!isConfigured()) redirect("/workspace");
  const { message } = await searchParams;
  const signup = mode === "signup";
  return (
    <main className={styles.shell}>
      <aside className={styles.panel}>
        <span className={styles.brand}><DatabaseBackup size={22}/> B&amp;RS</span>
        <div className={styles.statement}>
          <div className={styles.glyph}><Fingerprint size={58} strokeWidth={1}/></div>
          <h2>Know what<br/>you can recover.</h2>
          <p>Private file backups with measured, repeatable restore testing.</p>
        </div>
        <div className={styles.footer}><ShieldCheck size={16}/> Backup &amp; Recovery System</div>
      </aside>
      <section className={styles.content}>
        <form className={styles.form} action={authenticate.bind(null, mode)}>
          <h1>{signup ? "Create an account" : "Sign in"}</h1>
          <p>{signup ? "Set up a private recovery workspace." : "Open your recovery workspace."}</p>
          {message && <div className={styles.notice} role="status">{message}</div>}
          <label>Email address<input name="email" autoComplete="email" type="email" required placeholder="you@example.com" /></label>
          <label>Password<input name="password" autoComplete={signup ? "new-password" : "current-password"} type="password" required minLength={8} maxLength={128} placeholder="At least 8 characters" /></label>
          <button type="submit">{signup ? "Create account" : "Sign in"}</button>
          <div className={styles.switch}>{signup ? "Already registered?" : "New to B&RS?"} <Link href={signup ? "/signin" : "/signup"}>{signup ? "Sign in" : "Create an account"}</Link></div>
        </form>
      </section>
    </main>
  );
}
