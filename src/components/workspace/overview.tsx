"use client";

import Link from "next/link";
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Box, CalendarClock, Database, HardDrive, Layers3, ShieldCheck, Timer, type LucideIcon } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { bytes, dateOnly, duration, formatDate, isAvailable, isFailed, isSuccess, isVerified, newest, sourceName, timeOf, type WorkspaceData } from "./data";
import { Empty, Panel, Status } from "./ui";

function Metric({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string | number; detail: string }) {
  return <div className="brs-metric"><div className="brs-metric-label"><span>{label}</span><Icon size={17} strokeWidth={1.65} /></div><div className="brs-metric-value">{value}</div><small>{detail}</small></div>;
}

const tooltip = { backgroundColor: "#ffffff", border: "1px solid #e6eaf0", borderRadius: 9, fontSize: 12, boxShadow: "0 8px 20px #111c3412" };
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const axisTick = { fontSize: 11, fill: "#758093" };

function daySeries(data: WorkspaceData, observedAt: number) {
  const demoJobs = new Set(data.backups.filter((backup) => backup.demo_corrupt).map((backup) => backup.backup_job_id));
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(observedAt);
    date.setDate(date.getDate() - (6 - i));
    return { label: dateOnly(date.toISOString()), key: dayKey(date), backups: 0, failures: 0, storage: 0 };
  });
  for (const job of data.jobs) {
    if (!timeOf(job) || demoJobs.has(job.id)) continue;
    const day = days.find((item) => item.key === dayKey(new Date(timeOf(job)!)));
    if (!day) continue;
    if (isSuccess(job.status)) day.backups++;
    if (isFailed(job.status)) day.failures++;
  }
  for (const backup of data.backups.filter(isAvailable)) {
    if (!timeOf(backup)) continue;
    const date = new Date(timeOf(backup)!);
    date.setHours(0, 0, 0, 0);
    for (const [index, day] of days.entries()) {
      const end = new Date(observedAt);
      end.setDate(end.getDate() - (6 - index));
      end.setHours(23, 59, 59, 999);
      if (date <= end) day.storage += Number(backup.compressed_size || 0);
    }
  }
  return days;
}

function ActivityChart({ series }: { series: ReturnType<typeof daySeries> }) {
  const active = series.some((day) => day.backups || day.failures);
  return <div className="brs-chart brs-chart-primary">
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart data={series} margin={{ top: 10, right: 18, left: 1, bottom: 4 }}>
        <CartesianGrid stroke="#eaeef3" strokeDasharray="3 4" vertical={false} />
        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} tickMargin={10} minTickGap={12} />
        <YAxis width={29} allowDecimals={false} domain={[0, active ? "auto" : 4]} axisLine={false} tickLine={false} tick={axisTick} />
        <Tooltip contentStyle={tooltip} cursor={{ fill: "#eff3fd" }} />
        <Bar dataKey="backups" name="Succeeded" maxBarSize={23} fill="#355fd7" radius={[4, 4, 1, 1]} isAnimationActive={false} />
        <Bar dataKey="failures" name="Failed" maxBarSize={23} fill="#d87b74" radius={[4, 4, 1, 1]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
    {!active && <div className="brs-chart-empty"><Activity size={17} /><span>No backup activity in this period</span></div>}
  </div>;
}

export function Overview({ data, observedAt }: { data: WorkspaceData; observedAt: number }) {
  const demoJobs = new Set(data.backups.filter((backup) => backup.demo_corrupt).map((backup) => backup.backup_job_id));
  const jobs = data.jobs.filter((job) => !demoJobs.has(job.id));
  const success = newest(jobs.filter((job) => isSuccess(job.status)));
  const failed = jobs.filter((job) => isFailed(job.status)).length;
  const available = newest(data.backups.filter(isAvailable));
  const verified = available.filter(isVerified);
  const tests = newest(data.tests);
  const testResults = tests.filter((test) => ["passed", "failed", "partially_passed"].includes(test.status ?? ""));
  const passed = testResults.filter((test) => test.status === "passed").length;
  const storage = available.reduce((sum, backup) => sum + Number(backup.compressed_size || 0), 0);
  const actualBackups = available.filter((backup) => !backup.demo_corrupt);
  const testedBackupIds = new Set(testResults.filter((test) => test.status === "passed").map((test) => test.backup_id));
  const restorableCount = verified.filter((backup) => testedBackupIds.has(backup.id)).length;
  const targetAge = data.profile?.rpo_hours ?? 24;
  const targetDuration = data.profile?.rto_seconds ?? 60;
  const latestPoint = timeOf(verified[0] ?? {});
  const age = latestPoint ? Math.max(0, observedAt - new Date(latestPoint).getTime()) : null;
  const testedRestore = tests.find((test) => test.status === "passed");
  const actualRestore = newest(data.restores).find((restore) => isSuccess(restore.status) && restore.duration_ms != null);
  const recoveryMs = actualRestore?.duration_ms ?? testedRestore?.restore_duration_ms;
  const series = daySeries(data, observedAt);
  const performance = tests.filter((test) => test.duration_ms != null).slice(0, 7).reverse().map((test) => ({ label: dateOnly(timeOf(test)), duration: test.duration_ms }));
  const schedules = data.schedules.filter((schedule) => schedule.enabled && schedule.next_run_at).sort((a, b) => a.next_run_at!.localeCompare(b.next_run_at!)).slice(0, 4);
  const failedLast = isFailed(newest(jobs)[0]?.status);
  const health = failedLast || (age != null && age > targetAge * 3600000) ? "Attention needed" : restorableCount ? "Recovery tested" : available.length ? "Verification needed" : "Awaiting first backup";

  return <>
    <div className="brs-metrics">
      <Metric label="Backup sources" value={data.sources.length} icon={Database} detail={`${data.files.filter((file) => file.status !== "pending").length} registered files`} />
      <Metric label="Backups" value={actualBackups.length} icon={Layers3} detail={`${success.length} successful · ${failed} failed jobs`} />
      <Metric label="Archive storage" value={bytes(storage)} icon={HardDrive} detail="Private backup archives" />
      <Metric label="Restore test pass rate" value={testResults.length ? `${Math.round(passed / testResults.length * 100)}%` : "—"} icon={ShieldCheck} detail={testResults.length ? `${passed} passed of ${testResults.length} completed` : "No completed tests yet"} />
    </div>
    <div className="brs-dashboard-grid">
      <Panel title="Backup activity" description="Completed and failed jobs over the last seven days" action={<span className="brs-range"><CalendarClock size={14} /> Last 7 days</span>}>
        <ActivityChart series={series} />
        <div className="brs-chart-legend"><span><i /> Succeeded</span><span><i /> Failed</span></div>
      </Panel>
      <Panel title="Recovery posture" description="Evidence against your objectives" action={<Link className="brs-btn brs-icon-btn brs-ghost" href="/workspace/settings" aria-label="Recovery objective settings" title="Recovery objective settings"><ArrowUpRight size={16} /></Link>} className="brs-posture">
        <div className="brs-posture-status"><span className="brs-posture-icon"><ShieldCheck size={22} strokeWidth={1.65} /></span><div><strong>{health}</strong><small>{verified.length} verified {verified.length === 1 ? "point" : "points"} · {restorableCount} restore tested</small></div></div>
        <div className="brs-objective"><Timer size={16} /><div><strong>Recovery point objective</strong><small>Target ≤ {targetAge} h</small></div><span title={formatDate(latestPoint)} className={age == null ? "" : age <= targetAge * 3600000 ? "brs-objective-met" : "brs-objective-missed"}>{age == null ? "No point" : duration(age)}{age != null && <small>{age <= targetAge * 3600000 ? "Within target" : "Outside target"}</small>}</span></div>
        <div className="brs-objective"><ArrowDownToLine size={16} /><div><strong>Recovery time objective</strong><small>Target ≤ {targetDuration} s</small></div><span className={recoveryMs == null ? "" : recoveryMs <= targetDuration * 1000 ? "brs-objective-met" : "brs-objective-missed"}>{recoveryMs == null ? "No measurement" : duration(recoveryMs)}{recoveryMs != null && <small>{recoveryMs <= targetDuration * 1000 ? "Within target" : "Outside target"}</small>}</span></div>
        <div className="brs-posture-footer"><span title={formatDate(timeOf(success[0] ?? {}))}>Last backup <strong>{dateOnly(timeOf(success[0] ?? {}))}</strong></span><span title={formatDate(timeOf(tests[0] ?? {}))}>Latest test <strong>{dateOnly(timeOf(tests[0] ?? {}))}</strong></span></div>
      </Panel>
    </div>
    <div className="brs-dashboard-grid brs-dashboard-grid-equal">
      <Panel title="Storage usage" description="Storage of retained archives by creation date">
        {storage ? <div className="brs-chart"><ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={series} margin={{ top: 8, right: 13, left: 8, bottom: 5 }}>
            <CartesianGrid stroke="#eaeef3" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} tickMargin={9} minTickGap={12} />
            <YAxis width={52} tickFormatter={bytes} axisLine={false} tickLine={false} tick={axisTick} />
            <Tooltip contentStyle={tooltip} formatter={(value) => bytes(Number(value))} />
            <Area type="monotone" dataKey="storage" name="Retained archives" fill="#edf2ff" stroke="#4371df" strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer></div> : <Empty icon={HardDrive} title="No archives stored" description="Usage appears after a backup finishes." />}
      </Panel>
      <Panel title="Restore test performance" description="Total duration of your latest recorded tests">
        {performance.length ? <div className="brs-chart"><ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={performance} margin={{ top: 8, right: 13, left: 8, bottom: 5 }}>
            <CartesianGrid stroke="#eaeef3" strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} tickMargin={9} minTickGap={12} />
            <YAxis width={52} tickFormatter={duration} axisLine={false} tickLine={false} tick={axisTick} />
            <Tooltip contentStyle={tooltip} formatter={(value) => duration(Number(value))} />
            <Bar dataKey="duration" name="Duration" maxBarSize={31} fill="#5979ce" radius={[4, 4, 1, 1]} />
          </BarChart>
        </ResponsiveContainer></div> : <Empty icon={Timer} title="No restore measurements" description="Run a restore test to measure recovery." />}
      </Panel>
    </div>
    <div className="brs-dashboard-grid">
      <Panel title="Recent activity" action={<Link href="/workspace/audit" className="brs-link">Audit log <ArrowRight size={14} /></Link>}>
        {data.audit.length ? <div className="brs-feed">{newest(data.audit).slice(0, 5).map((event) => <div key={event.id}><span className="brs-feed-icon"><Activity size={16} /></span><div><strong>{event.operation.replace(/[_.-]/g, " ")}</strong><small>{formatDate(event.created_at)}</small></div><Status value={event.status} /></div>)}</div> : <Empty icon={Activity} title="No recent activity" description="Backup, restore, and configuration events will appear here." />}
      </Panel>
      <Panel title="Upcoming backups" action={<Link href="/workspace/jobs" className="brs-link">Schedules <ArrowRight size={14} /></Link>}>
        {schedules.length ? <div className="brs-feed">{schedules.map((schedule) => <div key={schedule.id}><span className="brs-feed-icon"><CalendarClock size={16} /></span><div><strong>{sourceName(data, schedule.source_id)}</strong><small>{formatDate(schedule.next_run_at)}</small></div></div>)}</div> : <Empty icon={Box} title="No backups scheduled" description="Add a schedule to back up a source automatically." />}
      </Panel>
    </div>
  </>;
}
