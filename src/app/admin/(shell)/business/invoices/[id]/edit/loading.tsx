// src/app/admin/(shell)/business/invoices/[id]/edit/loading.tsx
import type React from "react";

/**
 * Loading skeleton for the invoice edit page - mirrors the form + preview
 * two-column shape so the layout doesn't jump when the data resolves.
 * @returns The skeleton element.
 */
export default function EditInvoiceLoading(): React.ReactElement {
  return (
    <div>
      <div className="mb-6 h-8 w-56 animate-pulse rounded bg-admin-border" aria-hidden />
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-6">
        <div className="space-y-4" aria-hidden>
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-admin-border" />
            ))}
          </div>
          <div className="h-40 animate-pulse rounded-lg bg-admin-border" />
          <div className="h-24 animate-pulse rounded-lg bg-admin-border" />
        </div>
        <div
          className="mt-6 hidden animate-pulse rounded-xl border border-admin-border bg-admin-surface lg:mt-0 lg:block lg:aspect-210/297"
          aria-hidden
        />
      </div>
    </div>
  );
}
