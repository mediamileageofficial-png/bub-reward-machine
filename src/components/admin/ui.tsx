"use client";

import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { api, ApiError } from "@/lib/client/api";
import { bub, formatEventTime } from "@/config/bub";

/** Functional, calm admin primitives (the public UI carries the campaign styling). */

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      try {
        const d = await api<T>(path);
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          if (e instanceof ApiError && e.status === 401) window.location.reload();
          setError(e instanceof ApiError ? e.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, tick]);
  return { data, error, loading, reload };
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`border border-bub-line bg-white ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-bub-line px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-800">{title}</h2>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Btn({ tone = "default", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "default" | "primary" | "danger" | "ghost" }) {
  const t = {
    default: "bg-white text-neutral-900 border-neutral-300 hover:border-neutral-500",
    primary: "bg-neutral-900 text-white border-neutral-900 hover:bg-black",
    danger: "bg-white text-red-700 border-red-300 hover:border-red-600",
    ghost: "bg-transparent text-neutral-700 border-transparent hover:bg-neutral-100",
  }[tone];
  return <button className={`inline-flex min-h-9 items-center gap-1.5 border px-3 text-sm font-semibold disabled:opacity-40 ${t} ${className}`} {...rest} />;
}

export function Input({ label, className = "", ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className={`block text-xs font-semibold text-neutral-600 ${className}`}>
      {label}
      <input className="mt-1 block min-h-9 w-full border border-neutral-300 bg-white px-2.5 text-sm font-normal text-neutral-900 outline-none focus:border-neutral-900" {...rest} />
    </label>
  );
}

export function Select({ label, className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className={`block text-xs font-semibold text-neutral-600 ${className}`}>
      {label}
      <select className="mt-1 block min-h-9 w-full border border-neutral-300 bg-white px-2 text-sm font-normal text-neutral-900 outline-none focus:border-neutral-900" {...rest}>
        {children}
      </select>
    </label>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-bub-orange" />
      {label}
    </label>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "orange" | "red" | "blue" }) {
  const t = { neutral: "bg-neutral-100 text-neutral-700", green: "bg-green-100 text-green-800", orange: "bg-orange-100 text-orange-800", red: "bg-red-100 text-red-800", blue: "bg-blue-100 text-blue-800" }[tone];
  return <span className={`inline-block px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${t}`}>{children}</span>;
}

export function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="border border-bub-line bg-white p-4">
      <div className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="mt-1 font-display text-4xl text-neutral-900 normal-case">{typeof value === "number" ? value.toLocaleString("en-IN") : value}</div>
      {sub && <div className="mt-0.5 text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-bub-line text-left text-[11px] uppercase tracking-wider text-neutral-500">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-2 py-2 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-neutral-100 [&_td]:px-2 [&_td]:py-2 [&_td]:align-middle">{children}</tbody>
      </table>
      {empty && <p className="px-2 py-6 text-center text-sm text-neutral-500">Nothing here yet.</p>}
    </div>
  );
}

export function Notice({ kind = "error", children }: { kind?: "error" | "ok" | "info"; children: ReactNode }) {
  if (!children) return null;
  const t = { error: "border-red-500 bg-red-50 text-red-900", ok: "border-green-600 bg-green-50 text-green-900", info: "border-neutral-400 bg-neutral-50 text-neutral-800" }[kind];
  return <div className={`border-l-4 px-3 py-2 text-sm ${t}`}>{children}</div>;
}

export const fmtDate = (iso?: string | null) => (iso ? formatEventTime(iso, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

const OFFSET = bub.event.utcOffsetMinutes;

/** ISO ⇄ <input type="datetime-local"> in the event timezone (fixed offset from config). */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + OFFSET * 60000);
  return d.toISOString().slice(0, 16);
}
export function localInputToIso(v: string): string | null {
  if (!v) return null;
  const [date, time] = v.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - OFFSET * 60000).toISOString();
}

/** Uploads an admin asset: S3 presigned POST (type + size enforced by S3) in AWS mode, inline data URL in mock mode. */
export async function uploadAsset(file: File, kind: "logo" | "template"): Promise<string> {
  const plan = await api<{ mode: "inline" | "s3"; upload_url?: string; fields?: Record<string, string>; public_url?: string; max_bytes: number }>("/api/admin/uploads", {
    body: { content_type: file.type, kind, size: file.size },
  });
  if (file.size > plan.max_bytes) throw new Error(`File is too large (max ${Math.round(plan.max_bytes / 1_000_000)} MB).`);
  if (plan.mode === "s3" && plan.upload_url && plan.public_url) {
    const form = new FormData();
    for (const [k, v] of Object.entries(plan.fields ?? {})) form.append(k, v);
    form.append("file", file);
    const res = await fetch(plan.upload_url, { method: "POST", body: form });
    if (!res.ok) throw new Error("Upload failed");
    return plan.public_url;
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}
