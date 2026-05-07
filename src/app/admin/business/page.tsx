import type { Metadata } from "next";
import type React from "react";
import Link from "next/link";
import { requireAdminToken } from "@/shared/lib/auth";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { cn } from "@/shared/lib/cn";
import { prisma } from "@/shared/lib/prisma";
import { formatNZD } from "@/features/business/lib/business";
import { SheetImportButton } from "@/features/business/components/SheetImportButton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Business - Admin",
  robots: { index: false, follow: false },
};

/**
 * Business dashboard showing income, expense, and invoice summary stats.
 * @param root0 - Page props
 * @param root0.searchParams - URL search parameters containing the admin token
 * @returns Business dashboard element
 */
export default async function BusinessPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}): Promise<React.ReactElement> {
  const { token } = await searchParams;
  const t = requireAdminToken(token);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const [incomeEntries, expenseEntries, invoiceCount] = await Promise.all([
    prisma.incomeEntry.findMany({ select: { amount: true, date: true } }),
    prisma.expenseEntry.findMany({ select: { amountExcl: true, gstAmount: true, date: true } }),
    prisma.invoice.count(),
  ]);

  const totalIncome = incomeEntries.reduce((s, e) => s + e.amount, 0);
  const totalExpenses = expenseEntries.reduce((s, e) => s + e.amountExcl, 0);
  const totalGst = expenseEntries.reduce((s, e) => s + e.gstAmount, 0);
  const profit = totalIncome - totalExpenses;
  const taxReserve = totalIncome * 0.2;

  const monthIncome = incomeEntries
    .filter((e) => e.date >= monthStart && e.date < monthEnd)
    .reduce((s, e) => s + e.amount, 0);
  const monthExpenses = expenseEntries
    .filter((e) => e.date >= monthStart && e.date < monthEnd)
    .reduce((s, e) => s + e.amountExcl, 0);

  const cards = [
    {
      label: "Total income",
      value: formatNZD(totalIncome),
      color: "text-green-600",
      href: `/admin/business/income?token=${encodeURIComponent(t)}`,
    },
    {
      label: "Total expenses (excl. GST)",
      value: formatNZD(totalExpenses),
      color: "text-slate-700",
      href: `/admin/business/expenses?token=${encodeURIComponent(t)}`,
    },
    {
      label: "Profit",
      value: formatNZD(profit),
      color: profit >= 0 ? "text-green-600" : "text-red-600",
      href: `/admin/business?token=${encodeURIComponent(t)}`,
    },
    {
      label: "Tax reserve (20%)",
      value: formatNZD(taxReserve),
      color: "text-amber-600",
      href: `/admin/business?token=${encodeURIComponent(t)}`,
    },
    {
      label: "This month income",
      value: formatNZD(monthIncome),
      color: "text-green-600",
      href: `/admin/business/income?token=${encodeURIComponent(t)}`,
    },
    {
      label: "This month expenses",
      value: formatNZD(monthExpenses),
      color: "text-slate-700",
      href: `/admin/business/expenses?token=${encodeURIComponent(t)}`,
    },
    {
      label: "GST claimable",
      value: formatNZD(totalGst),
      color: "text-moonstone-600",
      href: `/admin/business/expenses?token=${encodeURIComponent(t)}`,
    },
    {
      label: "Invoices",
      value: String(invoiceCount),
      color: "text-russian-violet",
      href: `/admin/business/invoices?token=${encodeURIComponent(t)}`,
    },
  ];

  const links = [
    { label: "Income", href: `/admin/business/income?token=${encodeURIComponent(t)}` },
    { label: "Expenses", href: `/admin/business/expenses?token=${encodeURIComponent(t)}` },
    { label: "Invoices", href: `/admin/business/invoices?token=${encodeURIComponent(t)}` },
    { label: "Calculator", href: `/admin/business/calculator?token=${encodeURIComponent(t)}` },
  ];

  return (
    <AdminPageLayout token={t} current="business">
      <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>Business</h1>

      <div className={cn("mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4")}>
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className={cn(
              "rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm transition-shadow hover:shadow-md",
            )}
          >
            <p className={cn("text-xl font-extrabold", c.color)}>{c.value}</p>
            <p className={cn("mt-0.5 text-xs text-slate-500")}>{c.label}</p>
          </Link>
        ))}
      </div>

      <div className={cn("flex flex-wrap gap-3")}>
        {links.map((l) => (
          <Link
            key={l.label}
            href={l.href}
            className={cn(
              "bg-russian-violet rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90",
            )}
          >
            {l.label}
          </Link>
        ))}
      </div>

      <SheetImportButton token={t} />
    </AdminPageLayout>
  );
}
