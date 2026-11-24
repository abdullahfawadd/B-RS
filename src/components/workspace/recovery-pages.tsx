"use client";

import Link from "next/link";
import { useState } from "react";
import { Archive, ArrowRight, ArrowUpRight, ClipboardCheck, Download, File, FlaskConical, History, LockKeyhole, ShieldCheck, Timer, Undo2 } from "lucide-react";
import { backupName, bytes, display, duration, failedCount, formatDate, isAvailable, newest, shortId, sourceName, timeOf, type Action, type Backup, type Restore, type RestoreTest, type WorkspaceData } from "./data";
import { usePageDialog } from "./source-pages";
import { Empty, InlineReport, Menu, Notice, Panel, SelectField, Status, SubmitForm, Table } from "./ui";

const reportHref = (type: "test" | "backup", id: string) => `/api/report?type=${type}&id=${encodeURIComponent(id)}`;
const reportLink = (type: "test" | "backup", id: string) => <a className="brs-btn brs-small" href={reportHref(type, id)} download><Download size={14} /> JSON</a>;

function PointDetails({ backup, data }: { backup: Backup; data: WorkspaceData }) {
  const tests = newest(data.tests.filter((test) => test.backup_id === backup.id));
  const files = backup.manifest?.files ?? [];
  return <div className="brs-dialog-body">
    <dl className="brs-detail-grid">
      <div><dt>Source</dt><dd>{sourceName(data, backup.source_id)}</dd></div>
      <div><dt>Created</dt><dd>{formatDate(timeOf(backup))}</dd></div>
      <div><dt>Archive size</dt><dd>{bytes(backup.compressed_size)}</dd></div>
      <div><dt>Original size</dt><dd>{bytes(backup.original_size)}</dd></div>
      <div><dt>Integrity</dt><dd><Status value={backup.status} /></dd></div>
      <div><dt>Last verified</dt><dd>{formatDate(backup.verified_at)}</dd></div>
      <div><dt>Latest restore test</dt><dd>{tests.length ? <Status value={tests[0].status} /> : "No test recorded"}</dd></div>
      <div><dt>Encryption</dt><dd>{backup.encryption_enabled ? "AES-256-GCM" : "Disabled"}</dd></div>
      <div className="brs-detail-wide"><dt>Archive SHA-256</dt><dd><code>{backup.checksum || "—"}</code></dd></div>
    </dl>
    {!!files.length && <div className="brs-dialog-section"><h3>Archive manifest</h3><Table headers={["Path", "Size", "SHA-256"]}>{files.map((file) => <tr key={file.path}><td><strong>{file.path}</strong></td><td>{bytes(file.size)}</td><td><code className="brs-code-short" title={file.sha256}>{file.sha256}</code></td></tr>)}</Table></div>}
    <div className="brs-form-actions">{reportLink("backup", backup.id)}</div>
  </div>;
}

const operationDetails = {
  verify: { title: "Verify backup integrity", button: "Verify archive", explanation: "Read the stored archive and compare its contents to the checksums in its manifest.", success: "Integrity check completed" },
  restore: { title: "Restore recovery point", button: "Restore files", explanation: "Restore files to a new private destination. You can download verified files from Restore Operations.", success: "Restore processed" },
  test: { title: "Run isolated restore test", button: "Run restore test", explanation: "Extract the archive in temporary storage, validate the resulting files, and save the test report.", success: "Restore test processed" },
};

function OperationForm({ kind, backup, action, close, onDone }: { kind: keyof typeof operationDetails; backup: Backup; action: Action; close?: () => void; onDone?: () => void }) {
  const copy = operationDetails[kind];
  return <SubmitForm button={copy.button} onCancel={close} onSubmit={async () => {
    await action(kind, { id: backup.id, request_id: crypto.randomUUID() }, copy.success);
    close?.();
    onDone?.();
  }}>
    <div className="brs-summary-box"><Archive size={19} /><div><strong>{backup.name}</strong><small>{bytes(backup.compressed_size)} · {formatDate(timeOf(backup))}</small></div></div>
    <Notice>{copy.explanation}</Notice>
  </SubmitForm>;
}

export function Points({ data, action, historical, sourceFilter }: { data: WorkspaceData; action: Action; historical: boolean; sourceFilter?: string }) {
  const { setModal, dialog } = usePageDialog();
  const [source, selectSource] = useState(sourceFilter ?? "");
  const [query, setQuery] = useState("");
  const unfilteredRows = newest(historical ? data.backups : data.backups.filter(isAvailable));
  const rows = unfilteredRows.filter((backup) => (!source || backup.source_id === source) && (!query || `${backup.name} ${sourceName(data, backup.source_id)} ${backup.id}`.toLowerCase().includes(query.toLowerCase())));
  const latestTests = new Map<string, RestoreTest>();
  for (const test of newest(data.tests)) if (!latestTests.has(test.backup_id)) latestTests.set(test.backup_id, test);

  function details(backup: Backup) {
    setModal({ title: backup.name, description: backup.id, content: () => <PointDetails backup={backup} data={data} /> });
  }
  function run(kind: keyof typeof operationDetails, backup: Backup) {
    setModal({ title: operationDetails[kind].title, content: (close) => <OperationForm kind={kind} backup={backup} action={action} close={close} /> });
  }
  return <>
    <Panel title={historical ? "Archived backups" : "Available recovery points"} description={historical ? "Review archive results, sizes and manifests." : "Choose an archive to verify, restore or test."}>
      {!!unfilteredRows.length && <div className="brs-filterbar">
        <label className="brs-sr-only" htmlFor="brs-backup-search">Search backups</label><input id="brs-backup-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search backups" />
        <select aria-label="Filter by source" value={source} onChange={(event) => selectSource(event.target.value)}><option value="">All sources</option>{data.sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </div>}
      {rows.length ? <Table headers={historical ? ["Backup", "Source", "Status", "Archive size", "Created", ""] : ["Recovery point", "Integrity", "Latest restore test", "Size", "Created", ""]}>
        {rows.map((backup) => <tr key={backup.id}><td><button type="button" className="brs-table-label" onClick={() => details(backup)}><span className="brs-table-icon"><Archive size={15} /></span><span><strong>{backup.name}</strong>{backup.encryption_enabled && <small><LockKeyhole size={12} /> Encrypted archive</small>}</span></button></td>
          {historical ? <><td>{sourceName(data, backup.source_id)}</td><td><Status value={backup.status} /></td></> : <><td><Status value={backup.status} /></td><td>{latestTests.get(backup.id) ? <Status value={latestTests.get(backup.id)?.status} /> : <span className="brs-muted">No test</span>}</td></>}
          <td>{bytes(backup.compressed_size)}</td><td>{formatDate(timeOf(backup))}</td>
          <td><Menu label={`Actions for ${backup.name}`}><button type="button" onClick={() => details(backup)}>View manifest</button>
            {isAvailable(backup) && <><button type="button" onClick={() => run("verify", backup)}>Verify archive</button><button type="button" onClick={() => run("restore", backup)}>Restore files</button><button type="button" onClick={() => run("test", backup)}>Run restore test</button></>}
            <a href={reportHref("backup", backup.id)} download>Download report</a>
          </Menu></td></tr>)}
      </Table> : <Empty icon={Archive} title={unfilteredRows.length ? "No matching backups" : historical ? "No backups recorded" : "No recovery points available"} description={unfilteredRows.length ? "Clear the filters to see more archives." : "Create a backup from a source to store a recovery point."}>
        {!unfilteredRows.length && <Link className="brs-btn" href="/workspace/sources">Go to sources</Link>}
      </Empty>}
    </Panel>
    {dialog}
  </>;
}

function RestoreDetails({ restore, data }: { restore: Restore; data: WorkspaceData }) {
  const files = restore.output_files ?? [];
  return <div className="brs-dialog-body">
    <dl className="brs-detail-grid"><div><dt>Recovery point</dt><dd>{backupName(data, restore.backup_id)}</dd></div><div><dt>Status</dt><dd><Status value={restore.status} /></dd></div><div><dt>Size restored</dt><dd>{bytes(restore.bytes_restored)}</dd></div><div><dt>Duration</dt><dd>{duration(restore.duration_ms)}</dd></div><div><dt>Started</dt><dd>{formatDate(restore.started_at)}</dd></div><div><dt>Completed</dt><dd>{formatDate(restore.completed_at)}</dd></div></dl>
    {restore.error_message && <Notice danger>{restore.error_message}</Notice>}
    {!!files.length && <div className="brs-dialog-section"><h3>Verified files</h3><Table headers={["Path", "Size", ""]}>{files.map((file) => <tr key={file.path}><td><span className="brs-table-label"><File size={15} /> <strong>{file.path}</strong></span></td><td>{bytes(file.size)}</td><td><a className="brs-btn brs-small" href={`/api/download?id=${encodeURIComponent(restore.id)}&path=${encodeURIComponent(file.path)}`}><Download size={14} /> Download</a></td></tr>)}</Table></div>}
  </div>;
}

export function Restores({ data }: { data: WorkspaceData }) {
  const { setModal, dialog } = usePageDialog();
  return <>
    <Panel title="Restore history" description="Restored files and verification results">
      {data.restores.length ? <Table headers={["Operation", "Recovery point", "Status", "Files restored", "Bytes restored", "Duration", "Completed", ""]}>
        {newest(data.restores).map((restore) => <tr key={restore.id}><td><code>{shortId(restore.id)}</code></td><td><strong>{backupName(data, restore.backup_id)}</strong></td><td><Status value={restore.status} /></td><td>{restore.files_restored}</td><td>{bytes(restore.bytes_restored)}</td><td>{duration(restore.duration_ms)}</td><td>{formatDate(restore.completed_at)}</td>
          <td><button type="button" className="brs-btn brs-small" onClick={() => setModal({ title: "Restore operation", description: restore.id, content: () => <RestoreDetails restore={restore} data={data} /> })}>{restore.output_files?.length ? "View files" : "Details"}</button></td></tr>)}
      </Table> : <Empty icon={Undo2} title="No restore operations" description="Choose a recovery point to restore its files to a separate private destination."><Link className="brs-btn" href="/workspace/recovery">View recovery points</Link></Empty>}
    </Panel>
    {dialog}
  </>;
}

function TestDetails({ test, data }: { test: RestoreTest; data: WorkspaceData }) {
  const evidence = test.verification_details ?? [];
  return <div className="brs-dialog-body">
    <dl className="brs-detail-grid"><div><dt>Recovery point</dt><dd>{backupName(data, test.backup_id)}</dd></div><div><dt>Result</dt><dd><Status value={test.status} /></dd></div><div><dt>Started</dt><dd>{formatDate(test.started_at)}</dd></div><div><dt>Completed</dt><dd>{formatDate(test.completed_at)}</dd></div>
      <div><dt>Files tested</dt><dd>{test.files_tested}</dd></div><div><dt>Files verified</dt><dd>{test.files_verified}</dd></div><div><dt>Failed files</dt><dd>{failedCount(test)}</dd></div><div><dt>Bytes restored</dt><dd>{bytes(test.bytes_restored)}</dd></div>
      <div><dt>Restore</dt><dd>{duration(test.restore_duration_ms)}</dd></div><div><dt>Verification</dt><dd>{duration(test.verification_duration_ms)}</dd></div><div><dt>Total duration</dt><dd>{duration(test.duration_ms)}</dd></div><div><dt>Trigger</dt><dd>{display(test.trigger)}</dd></div>
    </dl>
    {test.error_message && <Notice danger>{test.error_message}</Notice>}
    {!!evidence.length && <div className="brs-dialog-section"><h3>Verification evidence</h3><InlineReport data={evidence} /></div>}
    <div className="brs-form-actions">{reportLink("test", test.id)}</div>
  </div>;
}

export function TestHistory({ data }: { data: WorkspaceData }) {
  const [status, filter] = useState("");
  const { setModal, dialog } = usePageDialog();
  const rows = newest(data.tests).filter((test) => !status || test.status === status);
  return <>
    <Panel title="Restore test results" description={`${data.tests.length} recorded in this workspace`}>
      {!!data.tests.length && <div className="brs-filterbar"><select aria-label="Filter by result" value={status} onChange={(event) => filter(event.target.value)}><option value="">All results</option>{[...new Set(data.tests.map((test) => test.status).filter(Boolean))].map((value) => <option key={value} value={value}>{display(value)}</option>)}</select></div>}
      {rows.length ? <Table headers={["Test ID", "Recovery point", "Result", "Tested", "Verified", "Failed", "Started", "Completed", "Duration", ""]}>
        {rows.map((test) => <tr key={test.id}><td><code>{shortId(test.id)}</code></td><td><strong>{backupName(data, test.backup_id)}</strong></td><td><Status value={test.status} /></td><td>{test.files_tested}</td><td>{test.files_verified}</td><td>{failedCount(test)}</td><td>{formatDate(test.started_at)}</td><td>{formatDate(test.completed_at)}</td><td>{duration(test.duration_ms)}</td>
          <td><button type="button" className="brs-btn brs-small" onClick={() => setModal({ title: "Restore test report", description: test.id, content: () => <TestDetails test={test} data={data} /> })}>Open report <ArrowUpRight size={13} /></button></td></tr>)}
      </Table> : <Empty icon={History} title={status ? "No matching tests" : "No restore tests recorded"} description="Test a recovery point to measure its recoverability."><Link className="brs-btn" href="/workspace/testing">Run a test</Link></Empty>}
    </Panel>
    {dialog}
  </>;
}

export function Testing({ data, action }: { data: WorkspaceData; action: Action }) {
  const backups = newest(data.backups.filter(isAvailable));
  const [selection, select] = useState("");
  const backup = backups.find((item) => item.id === selection) || backups[0];
  const latest = newest(data.tests)[0];
  return <div className="brs-page-columns">
    <Panel title="Test a recovery point" description="Run a restore in an isolated temporary directory.">
      {backup ? <div className="brs-panel-body">
        <SelectField label="Recovery point" name="test-backup" value={backup.id} onChange={select}>{backups.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatDate(timeOf(item))}</option>)}</SelectField>
        <OperationForm kind="test" backup={backup} action={action} />
      </div> : <Empty icon={FlaskConical} title="A backup is required" description="Create a recovery point before running a restore test."><Link className="brs-btn" href="/workspace/sources">Go to sources</Link></Empty>}
    </Panel>
    <Panel title="What the test checks">
      <div className="brs-checklist">
        <div><ShieldCheck size={17} /><span><strong>Archive integrity</strong><small>The stored checksum and manifest match the archive.</small></span></div>
        <div><Archive size={17} /><span><strong>Isolated extraction</strong><small>Files are extracted under a temporary test directory.</small></span></div>
        <div><ClipboardCheck size={17} /><span><strong>Restored file integrity</strong><small>Paths, byte sizes and SHA-256 hashes match.</small></span></div>
        <div><Timer size={17} /><span><strong>Measured recovery</strong><small>Timings and file results are recorded for review.</small></span></div>
      </div>
      {latest && <div className="brs-panel-body brs-latest-test"><div><strong>Latest restore test</strong><small>{formatDate(timeOf(latest))}</small></div><Status value={latest.status} /></div>}
      <div className="brs-panel-body brs-test-footer"><Link className="brs-link" href="/workspace/test-history">View test history <ArrowRight size={14} /></Link></div>
    </Panel>
  </div>;
}

export function Reports({ data }: { data: WorkspaceData }) {
  return <>
    <Panel title="Restore test reports" description="Result, per-file evidence and recovery timing">
      {data.tests.length ? <Table headers={["Test ID", "Recovery point", "Result", "Completed", "Download"]}>
        {newest(data.tests).map((test) => <tr key={test.id}><td><code>{shortId(test.id)}</code></td><td><strong>{backupName(data, test.backup_id)}</strong></td><td><Status value={test.status} /></td><td>{formatDate(test.completed_at)}</td><td>{reportLink("test", test.id)}</td></tr>)}
      </Table> : <Empty icon={ClipboardCheck} title="No restore test reports" description="Each restore test generates a downloadable record." />}
    </Panel>
    <Panel title="Backup reports" description="Archive metadata, job results and manifest">
      {data.backups.length ? <Table headers={["Backup", "Source", "Archive size", "Created", "Download"]}>
        {newest(data.backups).map((backup) => <tr key={backup.id}><td><strong>{backup.name}</strong></td><td>{sourceName(data, backup.source_id)}</td><td>{bytes(backup.compressed_size)}</td><td>{formatDate(timeOf(backup))}</td><td>{reportLink("backup", backup.id)}</td></tr>)}
      </Table> : <Empty icon={Archive} title="No backup reports" description="Backup reports appear when artifacts have been recorded." />}
    </Panel>
  </>;
}
