// src/app/admin/settings/page.tsx
import type { Metadata } from "next";
import type React from "react";
import Link from "next/link";
import { requireAdminToken } from "@/shared/lib/auth";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { cn } from "@/shared/lib/cn";
import {
  BUSINESS,
  BUSINESS_BANK_ACCOUNT,
  BUSINESS_GST_NUMBER,
  BUSINESS_PAYMENT_TERMS_DAYS,
} from "@/shared/lib/business-identity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings - Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin settings index - env summary + shortcuts to in-app settings screens.
 * @param root0 - Page props.
 * @param root0.searchParams - URL search params (contains token).
 * @returns Settings page element.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;
  const t = requireAdminToken(token);

  // Read-only env summary - shows whether configured, never the secret value.
  const envItems: { label: string; value: string; configured: boolean }[] = [
    {
      label: "GST number",
      value: BUSINESS_GST_NUMBER || "Not set",
      configured: !!BUSINESS_GST_NUMBER,
    },
    {
      label: "Bank account",
      value: BUSINESS_BANK_ACCOUNT.startsWith("[") ? "Not set" : BUSINESS_BANK_ACCOUNT,
      configured: !BUSINESS_BANK_ACCOUNT.startsWith("["),
    },
    {
      label: "Payment terms",
      value: `${BUSINESS_PAYMENT_TERMS_DAYS} days from issue`,
      configured: true,
    },
    {
      label: "Sheet ID",
      value: process.env.GOOGLE_SHEET_ID ? "Configured" : "Not set",
      configured: !!process.env.GOOGLE_SHEET_ID,
    },
    {
      label: "Drive folder",
      value: process.env.GOOGLE_BUSINESS_SHEETS_FOLDER_ID ? "Configured" : "Not set",
      configured: !!process.env.GOOGLE_BUSINESS_SHEETS_FOLDER_ID,
    },
    {
      label: "Admin secret",
      value: process.env.ADMIN_SECRET ? "Configured" : "Not set",
      configured: !!process.env.ADMIN_SECRET,
    },
  ];

  // Shortcuts to in-app settings screens.
  const inApp: { label: string; description: string; href: string }[] = [
    {
      label: "Rates",
      description:
        "Standard hourly + modifier deltas (Complex, At home, Student, etc.) and flat rates like Travel.",
      href: `/admin/business/calculator?token=${encodeURIComponent(t)}`,
    },
    {
      label: "Task taxonomy",
      description:
        "Devices + actions used to compose invoice line items. Managed inside the Calculator.",
      href: `/admin/business/calculator?token=${encodeURIComponent(t)}`,
    },
    {
      label: "Subscriptions",
      description:
        "Recurring expenses that auto-record on schedule (hosting, SaaS, software, etc.).",
      href: `/admin/business/expenses?token=${encodeURIComponent(t)}`,
    },
  ];

  return (
    <AdminPageLayout token={t} current="settings">
      <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>Settings</h1>

      <p className={cn("mb-6 text-sm text-slate-500")}>
        Read-only view of the env-driven identity values, plus shortcuts to the in-app screens that
        hold the editable settings (rates, taxonomy, subscriptions).
      </p>

      <section className={cn("mb-8")}>
        <h2 className={cn("text-russian-violet mb-3 text-sm font-bold uppercase tracking-wide")}>
          Business identity
        </h2>
        <div
          className={cn("overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm")}
        >
          <dl className={cn("divide-y divide-slate-100 text-sm")}>
            <div className={cn("flex items-center justify-between px-5 py-3")}>
              <dt className={cn("text-slate-600")}>Trading name</dt>
              <dd className={cn("font-medium text-slate-700")}>{BUSINESS.company}</dd>
            </div>
            <div className={cn("flex items-center justify-between px-5 py-3")}>
              <dt className={cn("text-slate-600")}>Operator</dt>
              <dd className={cn("font-medium text-slate-700")}>{BUSINESS.name}</dd>
            </div>
            <div className={cn("flex items-center justify-between px-5 py-3")}>
              <dt className={cn("text-slate-600")}>Email</dt>
              <dd className={cn("font-medium text-slate-700")}>{BUSINESS.email}</dd>
            </div>
            <div className={cn("flex items-center justify-between px-5 py-3")}>
              <dt className={cn("text-slate-600")}>Phone</dt>
              <dd className={cn("font-medium text-slate-700")}>{BUSINESS.phone}</dd>
            </div>
            <div className={cn("flex items-center justify-between px-5 py-3")}>
              <dt className={cn("text-slate-600")}>Website</dt>
              <dd className={cn("font-medium text-slate-700")}>{BUSINESS.website}</dd>
            </div>
            <div className={cn("flex items-center justify-between px-5 py-3")}>
              <dt className={cn("text-slate-600")}>Location</dt>
              <dd className={cn("font-medium text-slate-700")}>{BUSINESS.location}</dd>
            </div>
          </dl>
        </div>
        <p className={cn("mt-2 text-xs text-slate-400")}>
          These values live in{" "}
          <code className={cn("rounded bg-slate-100 px-1")}>
            src/shared/lib/business-identity.ts
          </code>
          - edit the file and redeploy to change them.
        </p>
      </section>

      <section className={cn("mb-8")}>
        <h2 className={cn("text-russian-violet mb-3 text-sm font-bold uppercase tracking-wide")}>
          Environment
        </h2>
        <div
          className={cn("overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm")}
        >
          <dl className={cn("divide-y divide-slate-100 text-sm")}>
            {envItems.map((it) => (
              <div key={it.label} className={cn("flex items-center justify-between px-5 py-3")}>
                <dt className={cn("text-slate-600")}>{it.label}</dt>
                <dd
                  className={cn(
                    "text-xs",
                    it.configured ? "text-slate-500" : "text-coquelicot-400 font-medium",
                  )}
                >
                  {it.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <p className={cn("mt-2 text-xs text-slate-400")}>
          Configured via <code className={cn("rounded bg-slate-100 px-1")}>.env.local</code> (dev)
          and Vercel project settings (production). Restart the server after changing.
        </p>
      </section>

      <section>
        <h2 className={cn("text-russian-violet mb-3 text-sm font-bold uppercase tracking-wide")}>
          In-app settings
        </h2>
        <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3")}>
          {inApp.map((it) => (
            <Link
              key={it.label}
              href={it.href}
              className={cn(
                "group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md",
              )}
            >
              <p className={cn("text-russian-violet text-sm font-bold")}>{it.label}</p>
              <p className={cn("mt-1 text-xs text-slate-500")}>{it.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </AdminPageLayout>
  );
}
