"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

export interface Me {
  email: string;
  role: "ADMIN" | "SPONSOR";
  sponsor_id: string | null;
  sponsor_name: string | null;
}

/** Loads the signed-in dashboard user; redirects to sign-in when missing or wrong role. */
export function useRequireRole(role: "ADMIN" | "SPONSOR", next: string) {
  const [me, setMe] = useState<Me | null>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api<{ user: Me | null; mock: boolean }>("/api/auth/me")
      .then((r) => {
        if (cancelled) return;
        if (!r.user) {
          window.location.assign(new URL(`/api/auth/login?next=${encodeURIComponent(next)}`, window.location.origin).toString());
          return;
        }
        if (r.user.role !== role) setDenied(true);
        else setMe(r.user);
      })
      .catch(() => !cancelled && setDenied(true));
    return () => {
      cancelled = true;
    };
  }, [role, next]);
  return { me, denied };
}
