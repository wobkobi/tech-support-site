// src/app/admin/login/page.tsx
/**
 * @description Admin login. Single password field, posts to /api/admin/login,
 * follows the `?next=` query param on success (defaults to /admin). Plain
 * server component shell; the form is a tiny client component below.
 */

import { LoginForm } from "@/features/admin/components/LoginForm";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin login page. Reads `?next=` to forward the operator back to where they
 * were trying to go after a successful sign-in.
 * @param root0 - Page props.
 * @param root0.searchParams - URL params with optional `next` redirect path.
 * @returns Login page element.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<React.ReactElement> {
  const { next } = await searchParams;
  // Only accept same-origin relative paths starting with `/admin` so a tainted
  // `?next=` can't bounce the operator to an external site.
  const nextPath = next && next.startsWith("/admin") ? next : "/admin";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-extrabold text-russian-violet">Admin sign-in</h1>
        <p className="mt-1 text-sm text-slate-500">
          Enter the admin secret to access the operator panel.
        </p>
        <div className="mt-5">
          <LoginForm nextPath={nextPath} />
        </div>
      </div>
    </div>
  );
}
