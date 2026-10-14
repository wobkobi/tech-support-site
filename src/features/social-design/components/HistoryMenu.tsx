"use client";
// src/features/social-design/components/HistoryMenu.tsx
// The editor's "History" dropdown: saved copies of the design from earlier editing
// sessions, newest first. Restoring one is an ordinary edit, so Undo takes it back.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { callApi } from "@/features/mailing/lib/api-client";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { FaClockRotateLeft } from "react-icons/fa6";

/** One saved copy in the list. */
interface VersionRow {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * History dropdown.
 * @param props - Component props.
 * @param props.designId - Design id.
 * @param props.onRestore - Restores a saved copy by id.
 * @returns Menu element.
 */
export function HistoryMenu({
  designId,
  onRestore,
}: {
  designId: string;
  onRestore: (versionId: string) => Promise<void>;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Load the list each time the menu opens, so a copy saved meanwhile shows.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void callApi<{ versions: VersionRow[] }>(`/api/admin/social/designs/${designId}/versions`).then(
      (res) => {
        if (!live) return;
        if (res.ok) setVersions(res.versions);
        else setError(res.error);
      },
    );
    /**
     * Closes when the press lands outside the menu.
     * @param e - Pointer event.
     */
    const onDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      live = false;
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, designId]);

  return (
    <div ref={rootRef} className="relative">
      <AdminButton
        variant="outline"
        onClick={() => {
          // Clear the last list so an old one never shows while the new one loads.
          setVersions(null);
          setError(null);
          setOpen((o) => !o);
        }}
      >
        <FaClockRotateLeft aria-hidden className="size-3" /> History
      </AdminButton>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1 flex max-h-[60vh] w-72 flex-col overflow-y-auto rounded-lg border border-admin-border bg-admin-surface p-2 shadow-lg">
          <p className="px-2 pb-2 text-sm text-admin-text-secondary">
            A copy is kept from before each editing session, up to the last 20.
          </p>
          {error && <p className="px-2 text-sm text-coquelicot-700">{error}</p>}
          {!versions && !error && <p className="px-2 text-sm text-admin-muted">Loading...</p>}
          {versions?.length === 0 && (
            <p className="px-2 text-sm text-admin-muted">
              No saved copies yet. One is kept after your first edit.
            </p>
          )}
          {versions?.map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-admin-bg"
            >
              <div className="min-w-0 text-sm">
                <p className="text-admin-text">{formatDateTimeShort(v.createdAt)}</p>
                <p className="truncate text-admin-muted">{v.name}</p>
              </div>
              <AdminButton
                size="xs"
                variant="outline"
                busy={busy === v.id}
                onClick={async () => {
                  setBusy(v.id);
                  await onRestore(v.id);
                  setBusy(null);
                  setOpen(false);
                }}
              >
                Restore
              </AdminButton>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
