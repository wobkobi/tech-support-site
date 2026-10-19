"use client";
// src/features/admin/components/LoginForm.tsx
// Admin login form: POSTs the secret to /api/admin/login, then goes to `next`.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { useRouter } from "next/navigation";
import type React from "react";
import { useRef, useState } from "react";

interface LoginFormProps {
  /** Validated relative path to land on after a successful sign-in. */
  nextPath: string;
}

/**
 * Single-field login form. One generic error for every failure, so a wrong password
 * can't be told apart from a rate limit.
 * @param props - Component props.
 * @param props.nextPath - Where to send the operator after a successful login.
 * @returns Login form element.
 */
export function LoginForm({ nextPath }: LoginFormProps): React.ReactElement {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secretRef = useRef<HTMLInputElement>(null);

  /**
   * Submits the secret and navigates to nextPath on success.
   * @param e - Form submit event.
   */
  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    // Read the DOM value: password-manager autofill can skip the input event.
    const value = secretRef.current?.value ?? secret;
    if (!value) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: value }),
      });
      if (!res.ok) {
        setError("Sign-in failed. Try again.");
        setBusy(false);
        return;
      }
      // Refresh so server components see the new cookie.
      router.push(nextPath);
      router.refresh();
    } catch {
      setError("Sign-in failed. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* Off-screen username so password managers save and autofill reliably;
          not display:none, or they'd ignore it. */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        defaultValue="admin"
        readOnly
        aria-hidden="true"
        tabIndex={-1}
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
      />
      <AdminField label="Admin secret" htmlFor="admin-secret">
        <AdminInput
          id="admin-secret"
          ref={secretRef}
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          required
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          disabled={busy}
        />
      </AdminField>
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
      <AdminButton type="submit" busy={busy} className="h-11">
        {busy ? "Signing in..." : "Sign in"}
      </AdminButton>
    </form>
  );
}
