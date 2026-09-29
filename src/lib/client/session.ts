"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { SessionState } from "./types";

const SESSION_KEY = "bub.session.v1";
const SRC_KEY = "bub.src.v1";
const SRC_PATTERN = /^[A-Za-z0-9_-]{1,24}$/;

function safeGet(store: "local" | "session", key: string): string | null {
  try {
    return (store === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
function safeSet(store: "local" | "session", key: string, value: string) {
  try {
    (store === "local" ? window.localStorage : window.sessionStorage).setItem(key, value);
  } catch {
    /* private mode — the flow still works for this page view */
  }
}

/** ?src from the current URL (validated), else the one remembered for this browser. */
export function currentSrc(): string | null {
  if (typeof window === "undefined") return null;
  const fromUrl = new URLSearchParams(window.location.search).get("src");
  if (fromUrl && SRC_PATTERN.test(fromUrl)) return fromUrl.toUpperCase();
  const stored = safeGet("local", SRC_KEY);
  return stored && SRC_PATTERN.test(stored) ? stored : null;
}

/** Appends ?src=… so the source is preserved on every link through the flow. */
export function withSrc(path: string, src: string | null): string {
  if (!src) return path;
  const [base, q = ""] = path.split("?");
  const params = new URLSearchParams(q);
  params.set("src", src);
  return `${base}?${params.toString()}`;
}

export function storedSessionId(): string | null {
  return typeof window === "undefined" ? null : safeGet("local", SESSION_KEY);
}

/**
 * Establishes (or resumes) the anonymous session for the public flow.
 * - Counts a QR visit once per browser tab session when the URL carries ?src.
 * - `event: "game_started"` marks the game as started.
 */
export function useBubSession(opts: { event?: "game_started"; onReady?: (s: SessionState) => void } = {}) {
  const [state, setState] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const started = useRef(false);
  const onReady = useRef(opts.onReady);
  useEffect(() => {
    onReady.current = opts.onReady;
  });

  const load = useCallback(async (event?: "visit" | "game_started") => {
    const s = currentSrc();
    setSrc(s);
    if (s) safeSet("local", SRC_KEY, s);
    const urlHasSrc = new URLSearchParams(window.location.search).has("src");
    const visitKey = `bub.visit.${s}`;
    const countVisit = event === undefined && urlHasSrc && s && !safeGet("session", visitKey);
    try {
      const next = await api<SessionState>("/api/session", {
        body: { session_id: storedSessionId(), src: s, event: countVisit ? "visit" : event },
      });
      safeSet("local", SESSION_KEY, next.session_id);
      if (countVisit) safeSet("session", visitKey, "1");
      setState(next);
      setError(null);
      return next;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      return null;
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      let ready = await load();
      if (ready && opts.event === "game_started") ready = (await load("game_started")) ?? ready;
      if (ready) onReady.current?.(ready);
    })();
  }, [load, opts.event]);

  const refresh = useCallback(() => load(), [load]);
  return { state, setState, error, src, refresh };
}
