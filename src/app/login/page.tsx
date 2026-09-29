"use client";

import { useEffect, useState } from "react";
import { BubLogo } from "@/components/bub/Brand";
import { api, ApiError } from "@/lib/client/api";

interface MockUser {
  user_id: string;
  email: string;
  role: "ADMIN" | "SPONSOR";
}

function safeNext(): string {
  const n = new URLSearchParams(window.location.search).get("next") ?? "";
  return n.startsWith("/") && !n.startsWith("//") ? n : "";
}

/**
 * Dashboard sign-in. Production: Cognito Hosted UI (via /api/auth/login).
 * Local mock mode (AWS_MOCK_MODE=true): pick a seeded demo user.
 */
export default function LoginPage() {
  const [users, setUsers] = useState<MockUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ users: MockUser[] }>("/api/auth/mock-users")
      .then((r) => setUsers(r.users))
      .catch(() => {
        window.location.assign(new URL(`/api/auth/login?next=${encodeURIComponent(safeNext() || "/admin")}`, window.location.origin).toString());
      });
  }, []);

  const signIn = async (u: MockUser) => {
    try {
      await api("/api/auth/mock-login", { body: { user_id: u.user_id } });
      window.location.assign(new URL(safeNext() || (u.role === "ADMIN" ? "/admin" : "/sponsor"), window.location.origin).toString());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign-in failed");
    }
  };

  return (
    <div className="admin-surface flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm border border-bub-line bg-white p-6">
        <div className="bg-bub-ink p-3">
          <BubLogo size="md" tone="light" />
        </div>
        <h1 className="mt-5 text-lg font-bold">Dashboard sign-in</h1>
        {!users && <p className="mt-2 text-sm text-neutral-600">Redirecting to sign-in…</p>}
        {users && (
          <>
            <p className="mt-1 text-sm text-neutral-600">
              Local mock mode — choose a demo account. In production this page redirects to Cognito.
            </p>
            <ul className="mt-4 space-y-2">
              {users.map((u) => (
                <li key={u.user_id}>
                  <button onClick={() => signIn(u)} className="flex w-full items-center justify-between border border-neutral-300 px-3 py-2.5 text-left text-sm hover:border-neutral-900">
                    <span className="font-semibold">{u.email}</span>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-orange-700">{u.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
