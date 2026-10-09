"use client";
// src/features/contacts/components/ContactListToolbar.tsx
// Toolbar for the admin contacts list: search and Export CSV, then the filter chips,
// Clear and the sort select. Presentation only - the list owns every value and setter and
// syncs them to the URL.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { ListToolbar } from "@/features/admin/components/ui/ListToolbar";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/** Sync filter: tri-state, since a contact is exactly one of synced or not. */
export type SyncFilter = "all" | "synced" | "unsynced";

/** List order. */
export type ContactSort = "name" | "newest" | "oldest";

/**
 * Classes for a filter chip button.
 * @param active - Whether the chip is selected.
 * @returns Class string.
 */
function chipClass(active: boolean): string {
  return cn(
    "h-9 rounded-full border px-3 text-sm font-semibold transition-colors",
    active
      ? "border-russian-violet bg-russian-violet text-white"
      : "border-admin-border-strong bg-admin-surface text-admin-text-secondary hover:border-russian-violet",
  );
}

/** Props for {@link ContactListToolbar}. */
interface ContactListToolbarProps {
  query: string;
  setQuery: (value: string) => void;
  exporting: boolean;
  onExport: () => void;
  syncFilter: SyncFilter;
  setSyncFilter: React.Dispatch<React.SetStateAction<SyncFilter>>;
  reviewedOnly: boolean;
  setReviewedOnly: React.Dispatch<React.SetStateAction<boolean>>;
  retainerOnly: boolean;
  setRetainerOnly: React.Dispatch<React.SetStateAction<boolean>>;
  noEmail: boolean;
  setNoEmail: React.Dispatch<React.SetStateAction<boolean>>;
  noPhone: boolean;
  setNoPhone: React.Dispatch<React.SetStateAction<boolean>>;
  anyFilter: boolean;
  onClearFilters: () => void;
  sort: ContactSort;
  setSort: (value: ContactSort) => void;
}

/**
 * Search, export, filter chips and sort for the contacts list.
 * @param props - Component props.
 * @param props.query - Search text.
 * @param props.setQuery - Sets the search text.
 * @param props.exporting - True while the CSV export runs.
 * @param props.onExport - Starts the CSV export.
 * @param props.syncFilter - Current sync filter.
 * @param props.setSyncFilter - Sets the sync filter.
 * @param props.reviewedOnly - "Has reviews" chip state.
 * @param props.setReviewedOnly - Sets the "Has reviews" chip.
 * @param props.retainerOnly - "Retainer" chip state.
 * @param props.setRetainerOnly - Sets the "Retainer" chip.
 * @param props.noEmail - "No email" chip state.
 * @param props.setNoEmail - Sets the "No email" chip.
 * @param props.noPhone - "No phone" chip state.
 * @param props.setNoPhone - Sets the "No phone" chip.
 * @param props.anyFilter - Whether any chip is on, which shows Clear.
 * @param props.onClearFilters - Turns every chip off.
 * @param props.sort - Current order.
 * @param props.setSort - Sets the order.
 * @returns The toolbar element.
 */
export function ContactListToolbar({
  query,
  setQuery,
  exporting,
  onExport,
  syncFilter,
  setSyncFilter,
  reviewedOnly,
  setReviewedOnly,
  retainerOnly,
  setRetainerOnly,
  noEmail,
  setNoEmail,
  noPhone,
  setNoPhone,
  anyFilter,
  onClearFilters,
  sort,
  setSort,
}: ContactListToolbarProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <ListToolbar
        className="mb-0"
        search={
          <AdminInput
            type="search"
            placeholder="Search name, email, phone, address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10"
          />
        }
        actions={
          <AdminButton variant="secondary" onClick={onExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Export CSV"}
          </AdminButton>
        }
      />

      {/* Filter chips - narrow the list without leaving the page. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSyncFilter((f) => (f === "synced" ? "all" : "synced"))}
          aria-pressed={syncFilter === "synced"}
          className={chipClass(syncFilter === "synced")}
        >
          Synced
        </button>
        <button
          type="button"
          onClick={() => setSyncFilter((f) => (f === "unsynced" ? "all" : "unsynced"))}
          aria-pressed={syncFilter === "unsynced"}
          className={chipClass(syncFilter === "unsynced")}
        >
          Unsynced
        </button>
        <button
          type="button"
          onClick={() => setReviewedOnly((v) => !v)}
          aria-pressed={reviewedOnly}
          className={chipClass(reviewedOnly)}
        >
          Has reviews
        </button>
        <button
          type="button"
          onClick={() => setRetainerOnly((v) => !v)}
          aria-pressed={retainerOnly}
          className={chipClass(retainerOnly)}
        >
          Retainer
        </button>
        <button
          type="button"
          onClick={() => setNoEmail((v) => !v)}
          aria-pressed={noEmail}
          className={chipClass(noEmail)}
        >
          No email
        </button>
        <button
          type="button"
          onClick={() => setNoPhone((v) => !v)}
          aria-pressed={noPhone}
          className={chipClass(noPhone)}
        >
          No phone
        </button>
        {anyFilter && (
          <AdminButton variant="ghost" onClick={onClearFilters} className="h-9 px-2.5">
            Clear
          </AdminButton>
        )}
        <AdminSelect
          aria-label="Sort contacts"
          value={sort}
          onChange={(e) => setSort(e.target.value as ContactSort)}
          className="ml-auto h-10 w-auto"
        >
          <option value="name">Name A-Z</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </AdminSelect>
      </div>
    </div>
  );
}
