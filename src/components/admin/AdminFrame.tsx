"use client";

import type { ReactNode } from "react";
import { BubLogo } from "@/components/bub/Brand";

export function AdminFrame({ title, email, badge, nav, children }: { title: string; email?: string; badge?: ReactNode; nav?: ReactNode; children: ReactNode }) {
  return (
    <div className="admin-surface min-h-dvh">
      <header className="bg-bub-ink text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <BubLogo size="sm" tone="light" />
            <span className="text-sm font-semibold uppercase tracking-widest text-white/70">{title}</span>
            {badge}
          </div>
          <div className="flex items-center gap-3 text-sm">
            {email && <span className="text-white/70">{email}</span>}
            <form action="/api/auth/logout" method="post">
              <button className="border border-white/30 px-2.5 py-1 text-xs font-semibold hover:border-white">Sign out</button>
            </form>
          </div>
        </div>
        {nav && <div className="mx-auto max-w-7xl overflow-x-auto px-4">{nav}</div>}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
