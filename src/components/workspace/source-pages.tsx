"use client";

import { useRef, useState, type ReactNode } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Archive, CalendarClock, Database, File, FolderOpen, FolderPlus, HardDriveUpload, History, LockKeyhole, Play, Plus, ShieldCheck, UploadCloud } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { bytes, display, duration, formatDate, newest, shortId, sourceName, type Action, type Schedule, type Source, type WorkspaceData } from "./data";
import { Dialog, Empty, Field, Menu, Notice, Panel, SelectField, Status, SubmitForm, Table, Toggle } from "./ui";

type Modal = { title: string; description?: string; content: (close: () => void) => ReactNode };
type ModalSetter = (value: Modal) => void;
const request = (id: string) => ({ id, request_id: crypto.randomUUID() });
const environments = ["UTC", "Asia/Karachi", "Asia/Kolkata", "Asia/Tokyo", "Asia/Dubai", "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney"];

export function usePageDialog() {
  const [modal, setModal] = useState<Modal | null>(null);
  const close = () => setModal(null);
  return { setModal, dialog: modal && <Dialog title={modal.title} description={modal.description} onClose={close}>{modal.content(close)}</Dialog> };
}

export function confirm(setModal: ModalSetter, title: string, description: string, button: string, run: () => Promise<unknown>) {
  setModal({ title, description, content: (close) => <SubmitForm button={button} destructive onCancel={close} onSubmit={async () => { await run(); close(); }} /> });
}

export function SourceEditor({ source, action, close }: { source?: Source; action: Action; close: () => void }) {
  return <SubmitForm button={source ? "Save changes" : "Create source"} onCancel={close} onSubmit={async (form) => {
    await action("source-save", { id: source?.id, name: form.get("name"), description: form.get("description"), auto_test: form.has("auto_test"), encryption_enabled: form.has("encryption_enabled") }, source ? "Source updated" : "Source created");
    close();
  }}>
    <Field label="Source name"><input name="name" required maxLength={100} placeholder="e.g. Project documents" defaultValue={source?.name} /></Field>
    <Field label="Description"><textarea name="description" maxLength={1000} placeholder="Files or folders covered by this source" defaultValue={source?.description} /></Field>
    <div className="brs-toggle-group"><Toggle label="Test every new backup" name="auto_test" checked={source?.auto_test ?? true} description="Run an isolated restore after a backup is created." />
    <Toggle label="Encrypt archives" name="encryption_enabled" checked={source?.encryption_enabled} description="Uses the workspace server encryption key." /></div>
  </SubmitForm>;
}

function FileUpload({ source, data, action, close }: { source: Source; data: WorkspaceData; action: Action; close: () => void }) {
  const [selected, select] = useState<{ path: string; file: File }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const current = data.files.filter((file) => file.source_id === source.id && file.status !== "pending");
  const pending = data.files.filter((file) => file.source_id === source.id && file.status === "pending");
  const totalBytes = selected.reduce((total, item) => total + item.file.size, 0);
  const existingBytes = current.reduce((total, item) => total + Number(item.file_size), 0);
  const held = pending.filter((item) => !selected.some((selectedItem) => selectedItem.path === item.relative_path));
  const reservedBytes = held.reduce((total, item) => total + Number(item.file_size), 0);
  const exceedsLimit = selected.some((item) => item.file.size > data.limits.maxFile) || selected.length + current.length + held.length > data.limits.maxFiles || totalBytes + existingBytes + reservedBytes > data.limits.maxSource;

  function add(files: FileList | null) {
    if (!files) return;
    select((previous) => {
      const map = new Map(previous.map((item) => [item.path, item]));
      Array.from(files).forEach((file) => {
        const path = file.webkitRelativePath || file.name;
        map.set(path, { path, file });
      });
      return [...map.values()];
    });
  }

  return <SubmitForm button="Upload files" onCancel={close} onSubmit={async () => {
    if (!selected.length) throw new Error("Choose at least one file.");
    if (exceedsLimit) throw new Error("The selection exceeds this source’s upload limits.");
    const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url || !publicKey) throw new Error("Supabase Storage is not configured.");
    const storage = createBrowserClient(url, publicKey).storage.from("source-files");
    try {
      setProgress("Preparing secure upload");
      const response = await action("upload-plan", { source_id: source.id, files: selected.map(({ path, file }) => ({ path, size: file.size, mime: file.type || "application/octet-stream" })) });
      const uploads = response.uploads as { id: string; path: string; storage_path: string; token: string }[] | undefined;
      if (!uploads || uploads.length !== selected.length) throw new Error("The server returned an incomplete upload plan.");
      const completed: string[] = [];
      const checksums: Record<string, string> = {};
      let failure: Error | null = null;
      try {
        for (const upload of uploads) {
          setProgress(`Uploading ${completed.length + 1} of ${uploads.length}`);
          const file = selected.find((item) => item.path.normalize("NFC") === upload.path)?.file;
          if (!file) throw new Error("A selected file no longer matches its upload authorization.");
          const { error } = await storage.uploadToSignedUrl(upload.storage_path, upload.token, file, { contentType: file.type || "application/octet-stream", upsert: false });
          if (error) {
            const code = "code" in error ? error.code : undefined;
            const duplicate = typeof code === "string" && ["ResourceAlreadyExists", "KeyAlreadyExists", "Duplicate"].includes(code);
            const legacy = (error.status === 409 || String(error.statusCode) === "409") && /already exists|duplicate/i.test(error.message);
            if (!duplicate && !legacy) throw error;
            const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
            checksums[upload.id] = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
          }
          completed.push(upload.id);
        }
      } catch (error) {
        failure = error instanceof Error ? error : new Error("A file could not be uploaded.");
      }
      if (completed.length) {
        setProgress("Checking files");
        await action("upload-complete", { source_id: source.id, ids: completed, checksums }, completed.length === uploads.length ? "Files uploaded" : `${completed.length} files uploaded`);
        if (failure) {
          const savedPaths = new Set(uploads.filter((item) => completed.includes(item.id)).map((item) => item.path));
          select((previous) => previous.filter((item) => !savedPaths.has(item.path.normalize("NFC"))));
        }
      }
      if (failure) throw failure;
      close();
    } finally {
      setProgress("");
    }
  }}>
    <div className={`brs-dropzone ${dragging ? "brs-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!progress) add(event.dataTransfer.files); }}>
      <UploadCloud size={24} strokeWidth={1.7} /><strong>Drop files here</strong>
      <small>Up to {bytes(data.limits.maxFile)} per file · {bytes(data.limits.maxSource)} per source · {data.limits.maxFiles} files</small>
      <div className="brs-actions">
        <button type="button" className="brs-btn" disabled={!!progress} onClick={() => input.current?.click()}><File size={15} /> Choose files</button>
        <button type="button" className="brs-btn" disabled={!!progress} onClick={() => folderInput.current?.click()}><FolderOpen size={15} /> Choose folder</button>
      </div>
      <input type="file" multiple hidden ref={input} onChange={(event) => { add(event.target.files); event.target.value = ""; }} />
      <input type="file" multiple hidden ref={(element) => { folderInput.current = element; element?.setAttribute("webkitdirectory", ""); }} onChange={(event) => { add(event.target.files); event.target.value = ""; }} />
    </div>
    {!!selected.length && <div className="brs-selected-list"><strong>{selected.length} selected · {bytes(totalBytes)}</strong>{selected.map(({ file, path }) => <div key={path}><File size={14} /><span title={path}>{path}</span><small>{bytes(file.size)}</small><button type="button" className="brs-link" disabled={!!progress} onClick={() => select((previous) => previous.filter((item) => item.path !== path))}>Remove</button></div>)}</div>}
    {exceedsLimit && <Notice danger>Remove files to meet the source limits before uploading.</Notice>}
    {progress && <Notice>{progress}…</Notice>}
  </SubmitForm>;
}

export function Sources({ data, action, onCreate }: { data: WorkspaceData; action: Action; onCreate: () => void }) {
  const { setModal, dialog } = usePageDialog();
  const [selectedSource, selectSource] = useState<string>();
  const active = data.sources.find((source) => source.id === selectedSource);
  const rows = data.files.filter((file) => file.source_id === active?.id);
  const pending = rows.some((file) => file.status === "pending");
  const pendingSources = new Set(data.files.filter((file) => file.status === "pending").map((file) => file.source_id));
  const fileGroups = new Map<string, { count: number; size: number }>();
  for (const row of data.files) {
    if (row.status === "pending") continue;
    const group = fileGroups.get(row.source_id) ?? { count: 0, size: 0 };
    group.count++;
    group.size += Number(row.file_size);
    fileGroups.set(row.source_id, group);
  }

  function upload(source: Source) {
    setModal({ title: `Upload to ${source.name}`, description: "Files are sent directly to private storage.", content: (close) => <FileUpload source={source} data={data} action={action} close={close} /> });
  }
  function runBackup(source: Source) {
    setModal({ title: "Create backup", description: `Archive the current files in ${source.name}.`, content: (close) => <SubmitForm button="Run backup" onCancel={close} onSubmit={async () => { await action("backup", request(source.id), "Backup processed"); close(); }}>
      <div className="brs-summary-box"><Archive size={19} /><div><strong>{source.name}</strong><small>{fileGroups.get(source.id)?.count ?? 0} files · {bytes(fileGroups.get(source.id)?.size)}</small></div></div>
      {source.auto_test && <Notice>A restore test will also run if the backup succeeds.</Notice>}
    </SubmitForm> });
  }

  return <>
    <Panel title="Sources" description={`${data.sources.length} configured in this workspace`}>
      {data.sources.length ? <Table headers={["Source", "Files", "Total size", "Protection", "Updated", ""]}>
        {newest(data.sources).map((source) => <tr key={source.id} className={active?.id === source.id ? "brs-tr-selected" : ""}>
          <td><button className="brs-table-label" type="button" onClick={() => selectSource(active?.id === source.id ? undefined : source.id)}><span className="brs-table-icon"><Database size={15} /></span><span><strong>{source.name}</strong>{source.description && <small>{source.description}</small>}</span></button></td>
          <td>{fileGroups.get(source.id)?.count ?? 0}</td><td>{bytes(fileGroups.get(source.id)?.size)}</td>
          <td><span className="brs-mini-tags">{source.auto_test && <span title="Auto-test enabled"><ShieldCheck size={14} /> Auto-test</span>}{source.encryption_enabled && <span title="Archive encryption enabled"><LockKeyhole size={14} /> AES-GCM</span>}{!source.auto_test && !source.encryption_enabled && "—"}</span></td>
          <td>{formatDate(source.updated_at ?? source.created_at)}</td>
          <td><Menu label={`Actions for ${source.name}`}>
            <button type="button" onClick={() => selectSource(source.id)}>View files</button>
            <button type="button" onClick={() => upload(source)}>Upload files</button>
            <button type="button" disabled={!fileGroups.get(source.id)?.count || pendingSources.has(source.id)} onClick={() => runBackup(source)}>Run backup</button>
            <Link href={`/workspace/backups?source=${encodeURIComponent(source.id)}`}>Backup history</Link>
            <button type="button" onClick={() => setModal({ title: "Edit source", content: (close) => <SourceEditor source={source} action={action} close={close} /> })}>Edit source</button>
            <button type="button" className="brs-danger-text" onClick={() => confirm(setModal, "Delete source", `Delete ${source.name} and its source files? This cannot be undone.`, "Delete source", async () => { await action("source-delete", { id: source.id }, "Source deleted"); if (active?.id === source.id) selectSource(undefined); })}>Delete source</button>
          </Menu></td>
        </tr>)}
      </Table> : <Empty icon={FolderPlus} title="Create your first source" description="Group files under a source to run backups and start tracking recovery points.">
        <button type="button" className="brs-btn brs-primary" onClick={onCreate}><Plus size={16} /> New source</button>
      </Empty>}
    </Panel>
    {active && <Panel title={active.name} description="Files registered for this backup source" action={<div className="brs-actions"><button type="button" className="brs-btn" onClick={() => upload(active)}><HardDriveUpload size={16} /> Upload files</button><button type="button" className="brs-btn brs-primary" disabled={!rows.length || pending} onClick={() => runBackup(active)}><Play size={15} /> Run backup</button></div>}>
      {pending && <div className="brs-panel-body"><Notice>Retry or remove pending uploads before running a backup.</Notice></div>}
      {rows.length ? <Table headers={["File", "Size", "SHA-256", "Uploaded", ""]}>
        {rows.map((row) => <tr key={row.id}><td><span className="brs-table-label"><File size={16} /><strong>{row.relative_path || row.original_filename}</strong></span></td><td>{bytes(row.file_size)}</td>
          <td>{row.sha256_checksum ? <code className="brs-code-short" title={row.sha256_checksum}>{row.sha256_checksum}</code> : <Status value={row.status} label={row.status === "pending" ? "Upload pending" : undefined} />}</td><td>{formatDate(row.uploaded_at)}</td>
          <td><Menu label={`Actions for ${row.original_filename}`}>
            {row.sha256_checksum && <button type="button" onClick={() => navigator.clipboard.writeText(row.sha256_checksum!).then(() => toast.success("Checksum copied"), () => toast.error("The checksum could not be copied"))}>Copy checksum</button>}
            <button type="button" className="brs-danger-text" onClick={() => confirm(setModal, "Remove file", `Remove ${row.relative_path || row.original_filename} from this source?`, "Remove file", () => action("file-delete", { id: row.id }, "File removed"))}>Remove file</button>
          </Menu></td></tr>)}
      </Table> : <Empty icon={UploadCloud} title="This source has no files" description="Upload files or select a folder to prepare this source for its first backup." />}
    </Panel>}
    {dialog}
  </>;
}

export function ScheduleEditor({ schedule, action, sources, close }: { schedule?: Schedule; action: Action; sources: Source[]; close: () => void }) {
  const [frequency, setFrequency] = useState(schedule?.frequency ?? "daily");
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const suggested = [...new Set([...environments, localZone, schedule?.timezone].filter((item): item is string => !!item))];
  return <SubmitForm button="Save schedule" onCancel={close} onSubmit={async (form) => {
    await action("schedule-save", { id: schedule?.id, source_id: form.get("source_id"), frequency, scheduled_time: form.get("scheduled_time"), timezone: form.get("timezone"), enabled: form.has("enabled"), weekday: Number(form.get("weekday") ?? 1) }, "Schedule saved");
    close();
  }}>
    <SelectField label="Source" name="source_id" defaultValue={schedule?.source_id || sources[0]?.id} required>{sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}</SelectField>
    <div className="brs-form-columns"><SelectField label="Frequency" name="frequency" value={frequency} onChange={setFrequency}><option value="daily">Daily</option><option value="weekly">Weekly</option></SelectField>
      <Field label="Local time"><input name="scheduled_time" type="time" defaultValue={schedule?.scheduled_time?.slice(0, 5) ?? "02:00"} required /></Field></div>
    {frequency === "weekly" && <SelectField label="Day of week" name="weekday" defaultValue={String(schedule?.weekday ?? 1)}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => <option key={day} value={index}>{day}</option>)}</SelectField>}
    <Field label="Time zone" hint="Enter an IANA time zone, such as Asia/Karachi."><input name="timezone" list="brs-iana-time-zones" defaultValue={schedule?.timezone ?? localZone} required /><datalist id="brs-iana-time-zones">{suggested.map((zone) => <option key={zone} value={zone} />)}</datalist></Field>
    <div className="brs-toggle-group"><Toggle name="enabled" label="Enable schedule" checked={schedule?.enabled ?? true} /></div>
    <Notice>On Vercel Hobby, the daily scheduler checks for due backups once per day. Your selected time determines when a backup becomes due.</Notice>
  </SubmitForm>;
}

export function Jobs({ data, action, onSchedule }: { data: WorkspaceData; action: Action; onSchedule: () => void }) {
  const { setModal, dialog } = usePageDialog();
  const diagnostics = new Set(data.backups.filter((backup) => backup.demo_corrupt).map((backup) => backup.backup_job_id));
  return <>
    <Panel title="Job history" description="Manual and scheduled backup attempts">
      {data.jobs.length ? <Table headers={["Job", "Source", "Result", "Started", "Duration", ""]}>
        {newest(data.jobs).map((job) => <tr key={job.id}><td><code>{shortId(job.id)}</code></td><td><strong>{sourceName(data, job.source_id)}</strong>{diagnostics.has(job.id) && <small className="brs-block-muted">Corruption demonstration</small>}</td><td><Status value={job.status} /></td><td>{formatDate(job.started_at ?? job.created_at)}</td><td>{duration(job.duration_ms)}</td>
          <td><button type="button" className="brs-btn brs-small" onClick={() => setModal({ title: "Backup job", description: job.id, content: () => <div className="brs-dialog-body">
            <dl className="brs-detail-grid"><div><dt>Source</dt><dd>{sourceName(data, job.source_id)}</dd></div><div><dt>Result</dt><dd><Status value={job.status} /></dd></div><div><dt>Started</dt><dd>{formatDate(job.started_at)}</dd></div><div><dt>Completed</dt><dd>{formatDate(job.completed_at)}</dd></div><div><dt>Duration</dt><dd>{duration(job.duration_ms)}</dd></div></dl>
            {job.error_message && <Notice danger>{job.error_message}</Notice>}
          </div> })}>Details</button></td></tr>)}
      </Table> : <Empty icon={History} title="No jobs yet" description="Launch a backup from a source to see progress and results here."><Link className="brs-btn" href="/workspace/sources">Go to sources</Link></Empty>}
    </Panel>
    <Panel title="Schedules" description="Manage backup frequency and execution windows">
      {data.schedules.length ? <Table headers={["Source", "Frequency", "Time zone", "Last run", "Next due", "Status", ""]}>
        {data.schedules.map((schedule) => <tr key={schedule.id}><td><strong>{sourceName(data, schedule.source_id)}</strong></td><td>{display(schedule.frequency)} · {schedule.scheduled_time.slice(0, 5)}</td><td>{schedule.timezone}</td><td>{formatDate(schedule.last_run_at)}</td><td>{schedule.enabled ? formatDate(schedule.next_run_at) : "—"}</td><td><Status value={schedule.enabled ? "enabled" : "paused"} /></td><td>
          <Menu label={`Actions for ${sourceName(data, schedule.source_id)} schedule`}>
            <button type="button" onClick={() => setModal({ title: "Edit schedule", content: (close) => <ScheduleEditor schedule={schedule} action={action} sources={data.sources} close={close} /> })}>Edit schedule</button>
            <button type="button" className="brs-danger-text" onClick={() => confirm(setModal, "Delete schedule", "Future backups will stop for this schedule.", "Delete schedule", () => action("schedule-delete", { id: schedule.id }, "Schedule deleted"))}>Delete schedule</button>
          </Menu>
        </td></tr>)}
      </Table> : <Empty icon={CalendarClock} title="No schedules configured" description="Set a daily or weekly backup schedule for an existing source.">
        {data.sources.length ? <button type="button" className="brs-btn" onClick={onSchedule}><Plus size={15} /> Add schedule</button> : <Link className="brs-btn" href="/workspace/sources">Go to sources</Link>}
      </Empty>}
    </Panel>
    {dialog}
  </>;
}
