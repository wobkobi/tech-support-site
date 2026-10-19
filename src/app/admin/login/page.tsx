// src/app/admin/login/page.tsx
// Admin login: one password field posting to /api/admin/login, then `?next=` (default /admin).

import { LoginForm } from "@/features/admin/components/LoginForm";
import { Card } from "@/features/admin/components/ui/Card";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin login page; `?next=` is where to go after sign-in.
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
  // Only same-origin `/admin` paths, so `?next=` can't redirect off-site.
  const nextPath = next && next.startsWith("/admin") ? next : "/admin";

  return (
    <div className="flex min-h-screen items-center justify-center bg-admin-bg p-6">
      <Card className="w-full max-w-sm sm:p-6">
        <h1 className="text-xl font-bold text-russian-violet">Admin sign-in</h1>
        <p className="mt-1 text-sm text-admin-muted">
          Enter the admin secret to access the operator panel.
        </p>
        <div className="mt-5">
          <LoginForm nextPath={nextPath} />
        </div>
      </Card>
    </div>
  );
}
