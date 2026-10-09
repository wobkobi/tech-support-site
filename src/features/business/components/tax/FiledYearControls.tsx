"use client";
// src/features/business/components/tax/FiledYearControls.tsx
// Filed status for one financial year on the Tax page: a "Filed on <date>" pill with an
// Unfile action, or a "Mark as filed" action. Both confirm first, POST to the tax-years
// route, then refresh the page so it switches between saved and live figures.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { StatusPill } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { formatDateShort } from "@/shared/lib/date-format";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";

/** Props for {@link FiledYearControls}. */
interface FiledYearControlsProps {
  /** FY key, e.g. "2025-26". */
  fyKey: string;
  /** FY display label. */
  fyLabel: string;
  /** ISO instant the year was marked filed, or null. */
  filedAtIso: string | null;
  /** False while the year is still running: filing waits until it ends. */
  canFile: boolean;
}

/**
 * Reads the route's JSON reply. A reply that isn't JSON (a proxy or server error page)
 * reads as a failure with no message, so the caller's fallback text shows.
 * @param res - The fetch response.
 * @returns The `ok` flag and any error message.
 */
async function readReply(res: Response): Promise<{ ok: boolean; error?: string }> {
  try {
    const data = (await res.json()) as { ok?: unknown; error?: unknown };
    return {
      ok: data.ok === true,
      error: typeof data.error === "string" ? data.error : undefined,
    };
  } catch {
    return { ok: false };
  }
}

/**
 * Filed pill and the file / unfile action for one year.
 * @param props - Component props.
 * @param props.fyKey - FY key.
 * @param props.fyLabel - FY display label.
 * @param props.filedAtIso - Filing instant, or null.
 * @param props.canFile - Whether the year has ended.
 * @returns The controls row.
 */
export function FiledYearControls({
  fyKey,
  fyLabel,
  filedAtIso,
  canFile,
}: FiledYearControlsProps): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const filed = filedAtIso !== null;

  /**
   * Sends the file or unfile action, then reloads the page's figures. A 409 means another
   * tab already changed the status (or the year hasn't ended), so the page reloads to show
   * where things stand.
   */
  async function submit(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/business/tax-years/${encodeURIComponent(fyKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: filed ? "unfile" : "file" }),
      });
      const data = await readReply(res);
      if (res.status === 409) {
        toast(
          `${data.error ?? "The filed status has changed."} The page now shows where it stands.`,
          { tone: "warning" },
        );
        setConfirming(false);
        router.refresh();
        return;
      }
      if (res.status === 401) {
        toast("You've been signed out. Sign in again, then try once more.", { tone: "error" });
        return;
      }
      if (!res.ok || !data.ok) {
        toast(data.error ?? `Couldn't change the filed status (error ${res.status}).`, {
          tone: "error",
        });
        return;
      }
      toast(filed ? `${fyLabel} is back on live figures.` : `${fyLabel} is marked filed.`, {
        tone: "success",
      });
      setConfirming(false);
      router.refresh();
    } catch {
      toast("Network error - nothing was changed.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      {filedAtIso !== null ? (
        <StatusPill tone="success">Filed on {formatDateShort(filedAtIso)}</StatusPill>
      ) : (
        <StatusPill tone="neutral">Not filed</StatusPill>
      )}
      {filed ? (
        <AdminButton variant="danger" onClick={() => setConfirming(true)} disabled={busy}>
          Unfile
        </AdminButton>
      ) : (
        <AdminButton
          variant="secondary"
          onClick={() => setConfirming(true)}
          disabled={!canFile || busy}
        >
          Mark as filed
        </AdminButton>
      )}
      {!filed && !canFile && (
        <p className="text-sm text-admin-text-secondary">
          You can mark this year filed once it ends on 31 March.
        </p>
      )}
      <ConfirmDialog
        open={confirming}
        title={filed ? `Unfile ${fyLabel}?` : `Mark ${fyLabel} as filed?`}
        body={
          filed ? (
            <p>
              This deletes the saved figures for {fyLabel} and goes back to live figures, which may
              not match the return your accountant filed. The next year&apos;s asset values are
              recalculated too. Only do this if the return is being amended.
            </p>
          ) : (
            <p>
              This saves the figures for {fyLabel} as they stand now. While the year is filed, the
              Tax page and the CSV show the saved figures, the home office and car form is locked,
              and the next year starts from the saved asset values. Later changes to assets, trips
              or expenses show up as a list of differences instead.
            </p>
          )
        }
        confirmLabel={filed ? "Unfile" : "Mark as filed"}
        tone={filed ? "danger" : "default"}
        busy={busy}
        onConfirm={() => void submit()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
