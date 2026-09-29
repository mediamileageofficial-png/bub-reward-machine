"use client";

import { useEffect, useState } from "react";
import { AdminFrame } from "@/components/admin/AdminFrame";
import { Overview } from "@/components/admin/sections/Overview";
import { Sources } from "@/components/admin/sections/Sources";
import { Sponsors } from "@/components/admin/sections/Sponsors";
import { Rewards } from "@/components/admin/sections/Rewards";
import { Coupons } from "@/components/admin/sections/Coupons";
import { Participants } from "@/components/admin/sections/Participants";
import { LuckyDraw } from "@/components/admin/sections/LuckyDraw";
import { Templates } from "@/components/admin/sections/Templates";
import { useRequireRole } from "@/lib/client/auth";

const TABS = [
  ["overview", "Overview", Overview],
  ["sources", "Sources / QR", Sources],
  ["sponsors", "Sponsors", Sponsors],
  ["rewards", "Rewards", Rewards],
  ["coupons", "Coupons", Coupons],
  ["participants", "Participants", Participants],
  ["lucky-draw", "Lucky Draw", LuckyDraw],
  ["templates", "Story Templates", Templates],
] as const;
type TabKey = (typeof TABS)[number][0];

function readTab(): TabKey {
  const h = typeof window === "undefined" ? "" : window.location.hash.slice(1);
  return (TABS.find(([k]) => k === h)?.[0] ?? "overview") as TabKey;
}

/** /admin — BUB/Aurix admin (Cognito group ADMIN). Every API call is authorised server-side too. */
export default function AdminPage() {
  const { me, denied } = useRequireRole("ADMIN", "/admin");
  const [tab, setTab] = useState<TabKey>("overview");

  useEffect(() => {
    const sync = () => setTab(readTab());
    window.addEventListener("hashchange", sync);
    const t = setTimeout(sync, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("hashchange", sync);
    };
  }, []);

  if (denied) {
    return (
      <AdminFrame title="Admin">
        <p className="text-sm">This account doesn&apos;t have admin access. Use “Sign out” above to switch accounts.</p>
      </AdminFrame>
    );
  }
  if (!me) return <AdminFrame title="Admin"><p className="text-sm text-neutral-500">Checking access…</p></AdminFrame>;

  const Active = TABS.find(([k]) => k === tab)![2];
  return (
    <AdminFrame
      title="Admin"
      email={me.email}
      nav={
        <nav className="flex gap-1">
          {TABS.map(([k, label]) => (
            <a key={k} href={`#${k}`} className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold ${tab === k ? "border-bub-orange text-white" : "border-transparent text-white/60 hover:text-white"}`}>
              {label}
            </a>
          ))}
        </nav>
      }
    >
      <Active />
    </AdminFrame>
  );
}
