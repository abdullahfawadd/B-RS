"use client";

import { useState } from "react";
import { ArchiveRestore, ClipboardList, FlaskConical, Plus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { backupName, display, formatDate, newest, sourceName, type Action, type Policy, type WorkspaceData } from "./data";
import { confirm, usePageDialog } from "./source-pages";
import { Empty, Field, InlineReport, Menu, Notice, Panel, SelectField, Status, SubmitForm, Table, Toggle } from "./ui";

const configOf = (policy: Policy) => policy.retention_configuration ?? policy;

export function PolicyEditor({ data, action, policy, close }: { data: WorkspaceData; action: Action; policy?: Policy; close: () => void }) {
  const config = policy ? configOf(policy) : null;
  return <SubmitForm button="Save policy" onCancel={close} onSubmit={async (form) => {
    await action("policy-save", {
      id: policy?.id, name: form.get("name"), source_id: form.get("source_id"),
      keep_latest: Number(form.get("keep_latest")), daily: Number(form.get("daily")), weekly: Number(form.get("weekly")),
      monthly: Number(form.get("monthly")), minimum: Number(form.get("minimum")), enabled: form.has("enabled"),
    }, "Retention policy saved");
    close();
  }}>
    <Field label="Policy name"><input name="name" maxLength={100} defaultValue={policy?.name} required placeholder="e.g. Monthly archive retention" /></Field>
    <SelectField label="Source" name="source_id" defaultValue={policy?.source_id || data.sources[0]?.id} required>
      <option value="" disabled>Select a source</option>{data.sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
    </SelectField>
    <div className="brs-form-columns">
      <Field label="Keep latest"><input type="number" min={1} max={100} name="keep_latest" required defaultValue={config?.keep_latest ?? 5} /></Field>
      <Field label="Minimum verified recovery points"><input type="number" min={1} max={100} name="minimum" required defaultValue={config?.minimum ?? 2} /></Field>
      <Field label="Daily copies"><input type="number" min={0} max={365} name="daily" required defaultValue={config?.daily ?? 7} /></Field>
      <Field label="Weekly copies"><input type="number" min={0} max={104} name="weekly" required defaultValue={config?.weekly ?? 4} /></Field>
      <Field label="Monthly copies"><input type="number" min={0} max={60} name="monthly" required defaultValue={config?.monthly ?? 3} /></Field>
    </div>
    <div className="brs-toggle-group"><Toggle label="Enable scheduled cleanup" name="enabled" checked={policy?.enabled ?? false} description="Apply eligible deletions when the scheduled process runs." /></div>
  </SubmitForm>;
}

function PreviewPolicy({ policy, action, close, data }: { policy: Policy; action: Action; close: () => void; data: WorkspaceData }) {
  const [preview, setPreview] = useState<Record<string, unknown>>();
  const [confirming, setConfirming] = useState(false);
  const eligible = Array.isArray(preview?.remove) ? preview.remove.filter((id): id is string => typeof id === "string") : [];
  const keep = Array.isArray(preview?.keep) ? preview.keep.length : 0;
  return <div className="brs-dialog-body">
    {preview ? <><Notice>{keep} retained · {eligible.length} eligible for deletion{policy.enabled ? "" : " · Enable this policy to apply it"}</Notice>
      {!!eligible.length && <Table headers={["Eligible archive", "Created", "Archive ID"]}>{eligible.map((id) => <tr key={id}><td><strong>{backupName(data, id)}</strong></td><td>{formatDate(data.backups.find((backup) => backup.id === id)?.created_at)}</td><td><code>{id}</code></td></tr>)}</Table>}
      <div className="brs-form-actions"><button className="brs-btn" type="button" onClick={close}>Close</button>
        <button className="brs-btn brs-destructive" type="button" onClick={() => setConfirming(true)} disabled={confirming || !policy.enabled || !eligible.length}>Apply policy</button></div>
      {confirming && <SubmitForm button="Delete eligible archives" destructive onCancel={() => setConfirming(false)} onSubmit={async () => { await action("policy-run", { id: policy.id }, "Retention cleanup processed"); close(); }}>
        <Notice danger>This will recompute eligible deletions and remove archived copies selected by the policy.</Notice>
      </SubmitForm>}
    </> : <SubmitForm button="Preview candidates" onCancel={close} onSubmit={async () => setPreview(await action("policy-preview", { id: policy.id }))}>
      <Notice>Review the archives that currently qualify for cleanup before applying this policy.</Notice>
    </SubmitForm>}
  </div>;
}

export function Retention({ data, action, onCreate }: { data: WorkspaceData; action: Action; onCreate: () => void }) {
  const { setModal, dialog } = usePageDialog();
  return <>
    <Panel title="Retention policies" description="Preserve recent recovery points and remove eligible older archives.">
      {data.policies.length ? <Table headers={["Policy", "Source", "Latest", "Daily / Weekly / Monthly", "Minimum", "Schedule", ""]}>
        {newest(data.policies).map((policy) => {
          const config = configOf(policy);
          return <tr key={policy.id}><td><strong>{policy.name}</strong></td><td>{sourceName(data, policy.source_id)}</td><td>{config.keep_latest ?? "—"}</td><td>{config.daily ?? 0} / {config.weekly ?? 0} / {config.monthly ?? 0}</td><td>{config.minimum ?? "—"}</td><td><Status value={policy.enabled ? "enabled" : "paused"} /></td>
            <td><Menu label={`Actions for ${policy.name}`}>
              <button type="button" onClick={() => setModal({ title: "Preview retention policy", description: policy.name, content: (close) => <PreviewPolicy policy={policy} action={action} close={close} data={data} /> })}>Preview and apply</button>
              <button type="button" onClick={() => setModal({ title: "Edit retention policy", content: (close) => <PolicyEditor data={data} action={action} policy={policy} close={close} /> })}>Edit policy</button>
              <button type="button" className="brs-danger-text" onClick={() => confirm(setModal, "Delete retention policy", `Remove ${policy.name} from the workspace?`, "Delete policy", () => action("policy-delete", { id: policy.id }, "Policy deleted"))}>Delete policy</button>
            </Menu></td></tr>;
        })}
      </Table> : <Empty icon={ArchiveRestore} title="No retention policies" description="Create a policy to control how many recovery points each source keeps.">
        {data.sources.length > 0 && <button type="button" className="brs-btn" onClick={onCreate}><Plus size={15} /> New policy</button>}
      </Empty>}
    </Panel>
    {dialog}
  </>;
}

export function AuditLog({ data }: { data: WorkspaceData }) {
  const [operation, setOperation] = useState("");
  const [status, setStatus] = useState("");
  const [resource, setResource] = useState("");
  const [date, setDate] = useState("");
  const { setModal, dialog } = usePageDialog();
  const rows = newest(data.audit).filter((event) => {
    const eventTime = event.created_at ? new Date(event.created_at) : null;
    const localTime = eventTime && `${eventTime.getFullYear()}-${String(eventTime.getMonth() + 1).padStart(2, "0")}-${String(eventTime.getDate()).padStart(2, "0")}`;
    return (!operation || event.operation === operation) && (!status || event.status === status) && (!resource || event.resource_type === resource) && (!date || localTime === date);
  });
  function options(values: (string | undefined)[]) {
    return [...new Set(values.filter((value): value is string => !!value))].sort().map((value) => <option key={value} value={value}>{display(value.replace(/\./g, " "))}</option>);
  }
  return <>
    <Panel title="Workspace events" description="Source, backup, restore and policy operations">
      {!!data.audit.length && <div className="brs-filterbar">
        <select aria-label="Filter by operation" value={operation} onChange={(event) => setOperation(event.target.value)}><option value="">All operations</option>{options(data.audit.map((event) => event.operation))}</select>
        <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{options(data.audit.map((event) => event.status))}</select>
        <select aria-label="Filter by resource" value={resource} onChange={(event) => setResource(event.target.value)}><option value="">All resources</option>{options(data.audit.map((event) => event.resource_type))}</select>
        <input aria-label="Filter by date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        {(operation || status || resource || date) && <button type="button" className="brs-btn" onClick={() => { setOperation(""); setStatus(""); setResource(""); setDate(""); }}>Clear filters</button>}
      </div>}
      {rows.length ? <Table headers={["Operation", "Resource", "Result", "Time", ""]}>
        {rows.map((event) => <tr key={event.id}><td><strong>{display(event.operation.replace(/\./g, " "))}</strong></td><td>{display(event.resource_type)}</td><td><Status value={event.status} /></td><td>{formatDate(event.created_at)}</td>
          <td><button type="button" className="brs-btn brs-small" onClick={() => setModal({ title: "Audit event", description: event.id, content: () => <div className="brs-dialog-body">
            <dl className="brs-detail-grid"><div><dt>Operation</dt><dd>{event.operation}</dd></div><div><dt>Status</dt><dd><Status value={event.status} /></dd></div><div><dt>Resource</dt><dd>{event.resource_type}</dd></div><div><dt>Time</dt><dd>{formatDate(event.created_at)}</dd></div><div className="brs-detail-wide"><dt>Resource ID</dt><dd><code>{event.resource_id || "—"}</code></dd></div></dl>
            {!!Object.keys(event.details ?? {}).length && <InlineReport data={event.details} />}
          </div> })}>Details</button></td></tr>)}
      </Table> : <Empty icon={ClipboardList} title={data.audit.length ? "No matching events" : "No audit events"} description={data.audit.length ? "Change the filters to show more events." : "Workspace activity is recorded as operations run."} />}
    </Panel>
    {dialog}
  </>;
}

export function Settings({ data, action }: { data: WorkspaceData; action: Action }) {
  const { setModal, dialog } = usePageDialog();
  const [profile, setProfile] = useState({
    display_name: data.profile?.display_name ?? "",
    rpo_hours: data.profile?.rpo_hours ?? 24,
    rto_seconds: data.profile?.rto_seconds ?? 60,
  });
  const hasDemo = data.sources.some((source) => source.demo);
  return <>
    <div className="brs-page-columns">
      <Panel title="Profile" description="Manage the display name and identity used in this workspace.">
        <div className="brs-panel-body">
          <div className="brs-summary-box"><UserRound size={19} /><div><strong>Signed-in account</strong><small>{data.email}</small></div></div>
          <SubmitForm button="Save profile" onSubmit={async (form) => {
            const values = { ...profile, display_name: String(form.get("display_name") ?? "") };
            await action("settings", values, "Profile saved");
            setProfile(values);
          }}>
            <Field label="Display name"><input name="display_name" defaultValue={profile.display_name} maxLength={100} placeholder="Your name" /></Field>
          </SubmitForm>
        </div>
      </Panel>
      <Panel title="Recovery objectives" description="Set the targets shown on your overview.">
        <div className="brs-panel-body">
          <SubmitForm button="Save objectives" onSubmit={async (form) => {
            const values = { ...profile, rpo_hours: Number(form.get("rpo_hours")), rto_seconds: Number(form.get("rto_seconds")) };
            await action("settings", values, "Recovery objectives saved");
            setProfile(values);
          }}>
            <Field label="Recovery point objective (hours)" hint="Maximum acceptable age of the latest verified recovery point."><input name="rpo_hours" type="number" min={1} max={8760} defaultValue={profile.rpo_hours} required /></Field>
            <Field label="Recovery time objective (seconds)" hint="Maximum acceptable duration to recover files."><input name="rto_seconds" type="number" min={1} max={86400} defaultValue={profile.rto_seconds} required /></Field>
          </SubmitForm>
        </div>
      </Panel>
    </div>
    <Panel title="Demonstration data" description="Create a sample source and exercise the backup and restoration pipeline.">
      <div className="brs-demo-row"><span className="brs-empty-icon"><FlaskConical size={20} /></span><div><strong>Backup and restore demonstration</strong><p>Upload fictional files, create and verify a backup, then compare a passing test with a test of a separate corrupted archive.</p></div>
        <div className="brs-actions">
          {hasDemo && <button className="brs-btn" type="button" onClick={() => confirm(setModal, "Reset demo data", "Delete the sample sources, archives and results in this workspace?", "Reset demo data", () => action("demo-reset", {}, "Demo data removed"))}><Trash2 size={15} /> Reset demo data</button>}
          <button className="brs-btn brs-primary" type="button" onClick={() => setModal({ title: "Run backup demonstration", description: "A sample source and its test results will appear in your workspace.", content: (close) => <SubmitForm button="Create demo data" onCancel={close} onSubmit={async () => { await action("demo", {}, "Demonstration completed"); close(); }}><Notice>Allow time for the sample files to upload and both restore tests to finish.</Notice></SubmitForm> })}><FlaskConical size={16} /> Create demo data</button>
        </div>
      </div>
    </Panel>
    <Panel title="Archive protection"><div className="brs-demo-row"><span className="brs-empty-icon"><ShieldCheck size={20} /></span><div><strong>Private storage</strong><p>Sources, archives and restored files are stored in access-controlled buckets. Optional archive encryption is set per source.</p></div></div></Panel>
    {dialog}
  </>;
}
