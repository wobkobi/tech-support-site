"use client";
// src/features/admin/components/LoginForm.tsx
/**
 * @file LoginForm.tsx
 * @description Client-side form for the admin login page. POSTs the secret
 * to /api/admin/login and navigates back to the requested `next` path on
 * success. Generic error on failure so a wrong password can't be
 * distinguished from a rate-limited one (defence-in-depth).
 */

import { useState } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/shared/lib/cn";

interface LoginFormProps {
  /** Validated relative path to land on after a successful sign-in. */
  nextPath: string;
}

/**
 * Single-field login form. Shows a generic error on any failure (wrong
 * password, rate-limited, network) so the operator can't read failure-mode
 * details off the UI.
 * @param props - Component props.
 * @param props.nextPath - Where to send the operator after a successful login.
 * @returns Login form element.
 */
export function LoginForm({ nextPath }: LoginFormProps): React.ReactElement {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Submits the secret. On 2xx response, navigates to nextPath. On any other
   * response (4xx, 5xx, network) shows a generic error.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      if (!res.ok) {
        setError("Sign-in failed. Try again.");
        setBusy(false);
        return;
      }
      // router.push + refresh so the cookie set in the response is visible to
      // server components on the next render.
      router.push(nextPath);
      router.refresh();
    } catch {
      setError("Sign-in failed. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn("flex flex-col gap-3")}>
      <label className={cn("flex flex-col gap-1")}>
        <span className={cn("text-xs font-semibold text-slate-600")}>Admin secret</span>
        <input
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          disabled={busy}
          className={cn(
            "focus:border-russian-violet focus:ring-russian-violet/30 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1",
          )}
        />
      </label>
      {error && (
        <p
          className={cn(
            "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700",
          )}
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || secret.length === 0}
        className={cn(
          "bg-russian-violet inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50",
        )}
      >
        {busy ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
