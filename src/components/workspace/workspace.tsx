"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Activity, Archive, ArchiveRestore, ArrowRight, Box, ChevronRight, ClipboardList, Database, FileText, FlaskConical, HardDrive, History, LayoutGrid, ListTodo, LoaderCircle, LogOut, Menu as MenuIcon, Plus, RefreshCcw, Settings2, ShieldCheck, Undo2, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Toaster, toast } from "sonner";
import { isFailed, type Action, type Section, type WorkspaceData } from "./data";
import { AuditLog, PolicyEditor, Retention, Settings } from "./admin-pages";
import { Overview } from "./overview";
import { Points, Reports, Restores, TestHistory, Testing } from "./recovery-pages";
import { Jobs, ScheduleEditor, SourceEditor, Sources, usePageDialog } from "./source-pages";
import { Empty, PageHeading, Panel } from "./ui";

const pages = {
  overview: { title: "Overview", icon: LayoutGrid, intro: "Monitor backup activity and measure how well your files can be recovered." },
  sources: { title: "Backup Sources", icon: Database, intro: "Organize files and folders into sources for manual or scheduled backups." },
  jobs: { title: "Backup Jobs", icon: ListTodo, intro: "Track backup executions and manage upcoming schedules." },
  backups: { title: "Backup History", icon: Archive, intro: "Inspect past backups, archive sizes, and file manifests." },
  recovery: { title: "Recovery Points", icon: Box, intro: "Inspect archive integrity, restore files, and validate recoverability." },
  restores: { title: "Restore Operations", icon: Undo2, intro: "Review completed restores and retrieve verified files." },
  testing: { title: "Restore Testing", icon: FlaskConical, intro: "Measure recoverability by restoring and checking a copy of your files." },
  "test-history": { title: "Restore Test History", icon: History, intro: "Review test timing, per-file evidence, and failure details." },
  retention: { title: "Retention Policies", icon: ArchiveRestore, intro: "Control archive retention and review eligible deletions." },
  reports: { title: "Reports", icon: FileText, intro: "Download evidence from backup and restore test operations." },
  audit: { title: "Audit Logs", icon: ClipboardList, intro: "Review operations recorded across your backup workspace." },
  settings: { title: "Settings", icon: Settings2, intro: "Manage your profile, recovery objectives, and demonstration data." },
} as const;

const groups: { label: string; items: Section[] }[] = [
  { label: "WORKSPACE", items: ["overview"] },
  { label: "BACKUP", items: ["sources", "jobs", "backups"] },
  { label: "RECOVERY", items: ["recovery", "restores", "testing", "test-history"] },
  { label: "MANAGEMENT", items: ["retention", "reports", "audit", "settings"] },
];

function SideNav({ active, open, close, data }: { active: Section; open: boolean; close: () => void; data: WorkspaceData | null }) {
  const name = data?.profile?.display_name || data?.email?.split("@")[0] || "";
  return <>
    {open && <button className="brs-mobile-overlay" aria-label="Close navigation" type="button" onClick={close} />}
    <aside className={`brs-sidebar ${open ? "brs-sidebar-open" : ""}`} aria-label="Workspace navigation">
      <Link className="brs-brand" href="/workspace" onClick={close} aria-label="Backup and Recovery System overview"><span className="brs-brand-icon"><ShieldCheck size={21} strokeWidth={1.9} /></span><span><strong>B&amp;RS</strong><small>Backup &amp; Recovery</small></span></Link>
      <button type="button" className="brs-btn brs-icon-btn brs-ghost brs-mobile-close" aria-label="Close navigation" onClick={close}><X size={19} /></button>
      <div className="brs-nav-wrap">
        <nav aria-label="Application pages">{groups.map((group) => <div className="brs-nav-group" key={group.label}>
          <span>{group.label}</span>
          {group.items.map((item) => { const page = pages[item]; const Icon = page.icon; return <Link className={active === item ? "brs-nav-active" : ""} aria-current={active === item ? "page" : undefined} href={item === "overview" ? "/workspace" : `/workspace/${item}`} onClick={close} key={item}><Icon size={16} strokeWidth={1.7} /><span>{page.title}</span></Link>; })}
        </div>)}</nav>
      </div>
      <div className="brs-sidebar-footer">
        <div className="brs-connection"><span className={data ? "connected" : ""} /> {data ? "Workspace connected" : "Workspace console"}</div>
        {!!data && <div className="brs-account"><span className="brs-avatar">{name.slice(0, 2).toUpperCase()}</span><div><strong title={name}>{name}</strong><small title={data.email}>{data.email}</small></div>
          <form action="/auth/signout" method="post"><button className="brs-btn brs-icon-btn brs-ghost" aria-label="Sign out" title="Sign out"><LogOut size={16} /></button></form></div>}
      </div>
    </aside>
  </>;
}

function Skeleton() {
  return <div className="brs-loading" role="status" aria-label="Loading workspace"><div className="brs-metrics">{Array.from({ length: 4 }, (_, i) => <div className="brs-skeleton" key={i} />)}</div><div className="brs-dashboard-grid"><div className="brs-skeleton" /><div className="brs-skeleton" /></div></div>;
}

export function Workspace({ section, sourceFilter }: { section: Section; sourceFilter?: string }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [observedAt, setObservedAt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<{ message: string; setup: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const { setModal, dialog } = usePageDialog();
  const page = pages[section];

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/workspace", { cache: "no-store", signal });
      if (response.status === 401) { router.replace("/signin"); return; }
      const result = await response.json();
      if (signal?.aborted) return;
      if (!response.ok) {
        setFailure({ message: result.error || "The workspace did not respond. Try refreshing.", setup: response.status === 503 });
        return;
      }
      setData(result as WorkspaceData);
      setObservedAt(Date.now());
      setFailure(null);
    } catch {
      if (!signal?.aborted) setFailure({ message: "The workspace could not be reached. Check your connection and try again.", setup: false });
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => refresh(controller.signal));
    return () => controller.abort();
  }, [refresh]);

  const action: Action = async (name, fields = {}, message) => {
    const response = await fetch("/api/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: name, ...fields }) });
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.status === 401) router.replace("/signin");
    if (name !== "policy-preview") await refresh();
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The operation could not be completed.");
    const status = typeof result.status === "string" ? result.status : undefined;
    if (isFailed(status)) throw new Error(typeof result.error === "string" ? result.error : "The operation failed. Open its history for details.");
    if (message && status === "partially_passed") toast.warning("The restore test recorded failures. Open its report to review them.");
    else if (message) toast.success(message);
    return result;
  };

  function addSource() { setModal({ title: "New backup source", description: "Create a source before uploading files or configuring a backup schedule.", content: (close) => <SourceEditor action={action} close={close} /> }); }
  function addSchedule() {
    if (data) setModal({ title: "New backup schedule", content: (close) => <ScheduleEditor action={action} sources={data.sources} close={close} /> });
  }
  function addPolicy() {
    if (data) setModal({ title: "New retention policy", content: (close) => <PolicyEditor data={data} action={action} close={close} /> });
  }

  const actions = data && {
    overview: <><Link href="/workspace/testing" className="brs-btn"><FlaskConical size={16} /> Run restore test</Link><button type="button" className="brs-btn brs-primary" onClick={addSource}><Plus size={16} /> New source</button></>,
    sources: <button type="button" className="brs-btn brs-primary" onClick={addSource}><Plus size={16} /> New source</button>,
    jobs: <button type="button" className="brs-btn brs-primary" onClick={addSchedule} disabled={!data.sources.length}><Plus size={16} /> New schedule</button>,
    retention: <button type="button" className="brs-btn brs-primary" onClick={addPolicy} disabled={!data.sources.length}><Plus size={16} /> New policy</button>,
    restores: <Link className="brs-btn" href="/workspace/recovery">Recovery points <ArrowRight size={16} /></Link>,
    "test-history": <Link className="brs-btn brs-primary" href="/workspace/testing"><FlaskConical size={16} /> Run restore test</Link>,
  };

  function content() {
    if (!data) return null;
    switch (section) {
      case "overview": return <Overview data={data} observedAt={observedAt} />;
      case "sources": return <Sources data={data} action={action} onCreate={addSource} />;
      case "jobs": return <Jobs data={data} action={action} onSchedule={addSchedule} />;
      case "backups": return <Points key={sourceFilter || "history"} data={data} action={action} historical sourceFilter={sourceFilter} />;
      case "recovery": return <Points key="recovery" data={data} action={action} historical={false} />;
      case "restores": return <Restores data={data} />;
      case "testing": return <Testing data={data} action={action} />;
      case "test-history": return <TestHistory data={data} />;
      case "retention": return <Retention data={data} action={action} onCreate={addPolicy} />;
      case "reports": return <Reports data={data} />;
      case "audit": return <AuditLog data={data} />;
      case "settings": return <Settings data={data} action={action} />;
    }
  }

  return <div className="brs-app">
    <a className="brs-skip" href="#workspace-main">Skip to content</a>
    <SideNav active={section} open={open} close={() => setOpen(false)} data={data} />
    <div className="brs-main">
      <header className="brs-topbar">
        <button type="button" className="brs-btn brs-icon-btn brs-mobile-menu" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)}><MenuIcon size={18} /></button>
        <div className="brs-breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{page.title}</strong></div>
        <div className="brs-topbar-right"><span className="brs-topbar-storage"><HardDrive size={14} /> Private workspace</span><button type="button" className="brs-btn brs-icon-btn brs-ghost" onClick={() => { setLoading(true); void refresh(); }} aria-label="Refresh workspace" title="Refresh workspace" disabled={loading}>{loading ? <LoaderCircle size={16} className="brs-spin" /> : <RefreshCcw size={16} />}</button></div>
      </header>
      <main className="brs-content" id="workspace-main">
        <PageHeading title={page.title} subtitle={page.intro}>{actions?.[section as keyof typeof actions]}</PageHeading>
        {loading && !data ? <Skeleton /> : failure ? <Panel><Empty icon={failure.setup ? Database : Activity} title={failure.setup ? "Connect your Supabase project" : "Workspace unavailable"} description={failure.message}>
          <button type="button" className="brs-btn" onClick={() => { setLoading(true); void refresh(); }}><RefreshCcw size={15} /> Try again</button>
        </Empty></Panel> : <motion.div className="brs-stack" key={section} initial={reduced ? false : { opacity: 0.35, y: 2 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }}>{content()}</motion.div>}
      </main>
    </div>
    {dialog}
    <Toaster richColors position="bottom-right" />
  </div>;
}
