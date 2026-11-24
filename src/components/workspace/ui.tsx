"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ChevronDown, Ellipsis, LoaderCircle, X, type LucideIcon } from "lucide-react";
import { display, isFailed, isSuccess } from "./data";

export function Status({ value, label }: { value?: string; label?: string }) {
  const tone = isSuccess(value) || value === "active" || value === "enabled" ? "success"
    : isFailed(value) ? "danger"
      : ["running", "uploading", "partially_passed", "warning", "due"].includes(value ?? "") ? "warn" : "neutral";
  return <span className={`brs-status ${tone}`}><span />{label || display(value)}</span>;
}

export function PageHeading({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return <div className="brs-page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div>{children && <div className="brs-actions">{children}</div>}</div>;
}

export function Panel({ title, description, children, action, className = "" }: { title?: string; description?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <section className={`brs-panel ${className}`}>{title && <div className="brs-panel-head"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>}{children}</section>;
}

export function Empty({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children?: ReactNode }) {
  return <div className="brs-empty"><div className="brs-empty-icon"><Icon size={21} strokeWidth={1.7} /></div><h3>{title}</h3><p>{description}</p>{children && <div>{children}</div>}</div>;
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return <div className="brs-table-scroll"><table className="brs-table"><thead><tr>{headers.map((header, index) => <th key={header || index} scope="col">{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}

export function Menu({ children, label = "Actions" }: { children: ReactNode; label?: string }) {
  const [position, setPosition] = useState<{ top?: number; bottom?: number; right: number; maxHeight: number }>();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!position) return;
    function dismiss() { setPosition(undefined); }
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) dismiss();
    }
    menu.current?.querySelector<HTMLElement>("button:not(:disabled),a")?.focus({ preventScroll: true });
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", dismiss, true); };
  }, [position]);
  function toggle() {
    if (position) { setPosition(undefined); return; }
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    const above = below < 210 && rect.top > below;
    setPosition({ right: Math.max(8, window.innerWidth - rect.right), maxHeight: Math.max(60, (above ? rect.top : below) - 12), ...(above ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) });
  }
  return <>
    <button type="button" className="brs-btn brs-icon-btn" ref={trigger} onClick={toggle} aria-label={label} title={label} aria-expanded={!!position} aria-controls={position ? menuId : undefined}><Ellipsis size={17} /></button>
    {position && createPortal(<div className="brs-menu-content" id={menuId} ref={menu} style={position} onKeyDown={(event) => {
      if (event.key === "Escape") { setPosition(undefined); trigger.current?.focus(); }
    }} onClick={(event) => {
      if ((event.target as HTMLElement).closest("button:not(:disabled),a")) { setPosition(undefined); trigger.current?.focus(); }
    }}>{children}</div>, document.body)}
  </>;
}

export function SelectField({ label, name, children, value, defaultValue, onChange, required, disabled }: { label: string; name: string; children: ReactNode; value?: string; defaultValue?: string; onChange?: (value: string) => void; required?: boolean; disabled?: boolean }) {
  return <label className="brs-field">{label}<span className="brs-select"><select name={name} value={value} defaultValue={defaultValue} onChange={onChange && ((event) => onChange(event.target.value))} required={required} disabled={disabled}>{children}</select><ChevronDown size={14} /></span></label>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="brs-field">{label}{children}{hint && <small>{hint}</small>}</label>;
}

export function Toggle({ label, name, description, checked }: { label: string; name: string; description?: string; checked?: boolean }) {
  return <label className="brs-toggle">
    <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
    <input type="checkbox" name={name} defaultChecked={checked} />
  </label>;
}

export function Dialog({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = modal.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog className="brs-dialog" ref={modal} onCancel={(event) => { event.preventDefault(); onClose(); }} aria-labelledby="dialog-heading" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="brs-dialog-inner">
      <header><div><h2 id="dialog-heading">{title}</h2>{description && <p>{description}</p>}</div><button type="button" className="brs-btn brs-icon-btn brs-ghost" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></header>
      {children}
    </div>
  </dialog>;
}

export function SubmitForm({ onSubmit, children, button, onCancel, destructive = false }: { onSubmit: (values: FormData) => Promise<unknown>; children?: ReactNode; button: string; onCancel?: () => void; destructive?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setError("");
    setBusy(true);
    try { await onSubmit(values); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The operation could not be completed."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="brs-form">
    {children}
    {error && <Notice danger>{error}</Notice>}
    <div className="brs-form-actions">
      {onCancel && <button type="button" className="brs-btn" onClick={onCancel} disabled={busy}>Cancel</button>}
      <button className={`brs-btn ${destructive ? "brs-destructive" : "brs-primary"}`} disabled={busy}>{busy && <LoaderCircle size={15} className="brs-spin" />}{button}</button>
    </div>
  </form>;
}

export function Notice({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return <div className={`brs-notice ${danger ? "brs-notice-danger" : ""}`} role={danger ? "alert" : undefined}><AlertCircle size={16} /> <div>{children}</div></div>;
}

export function InlineReport({ data }: { data: unknown }) {
  return <pre className="brs-json">{JSON.stringify(data, null, 2)}</pre>;
}
