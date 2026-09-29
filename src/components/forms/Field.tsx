import type { InputHTMLAttributes } from "react";

export function Field({ label, hint, prefix, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; prefix?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-bub-muted">{label}</span>
      <span className="mt-1.5 flex items-stretch border border-bub-line bg-bub-card text-bub-ink cut-br focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-bub-orange">
        {prefix && <span className="flex items-center border-r border-bub-ink/15 px-3 text-lg font-semibold text-bub-ink/60">{prefix}</span>}
        <input {...input} className="min-h-14 w-full bg-transparent px-4 text-lg font-semibold outline-none placeholder:text-bub-ink/35" />
      </span>
      {hint && <span className="mt-1.5 block text-xs text-bub-muted">{hint}</span>}
    </label>
  );
}
