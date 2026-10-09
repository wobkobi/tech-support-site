"use client";
// src/features/mailing/components/MailingView.tsx
// Mailing list home: emails by stage (drafts, scheduled, sent) plus the editable
// presets, and the subscribers panel. New email opens a blank draft straight in the
// editor, where the template dropdown swaps between presets.

import {
  ROW_CLS,
  TABLE_CLS,
  TBODY_CLS,
  TD_CLS,
  TH_CLS,
  THEAD_CLS,
} from "@/features/admin/components/ui/admin-table";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminTabs } from "@/features/admin/components/ui/AdminTabs";
import { Card } from "@/features/admin/components/ui/Card";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { ListToolbar } from "@/features/admin/components/ui/ListToolbar";
import { StatusPill, type StatusTone } from "@/features/admin/components/ui/StatusPill";
import { useToast } from "@/features/admin/components/ui/Toast";
import { LEDGER_LINK_CLS, ROW_BUTTON_CLS } from "@/features/business/components/ledger-classes";
import { SubscribersPanel } from "@/features/mailing/components/SubscribersPanel";
import { callApi } from "@/features/mailing/lib/api-client";
import type { CampaignRow, CampaignStatus } from "@/features/mailing/lib/campaign-row";
import type { Recipient } from "@/features/mailing/lib/recipients";
import { cn } from "@/shared/lib/cn";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { FaPlus } from "react-icons/fa6";

type Tab = "drafts" | "scheduled" | "sent" | "presets";

const TABS: { key: Tab; label: string }[] = [
  { key: "drafts", label: "Drafts" },
  { key: "scheduled", label: "Scheduled" },
  { key: "sent", label: "Sent" },
  { key: "presets", label: "Presets" },
];

const STATUS_PILL: Record<CampaignStatus, { tone: StatusTone; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  scheduled: { tone: "info", label: "Scheduled" },
  sending: { tone: "warning", label: "Sending" },
  sent: { tone: "success", label: "Sent" },
  failed: { tone: "critical", label: "Failed" },
};

/**
 * Which tab a campaign belongs on.
 * @param c - Campaign row.
 * @returns Its tab.
 */
function tabOf(c: CampaignRow): Tab {
  if (c.isPreset) return "presets";
  if (c.status === "draft") return "drafts";
  if (c.status === "scheduled") return "scheduled";
  return "sent";
}

/**
 * The date that matters for a row: when it went or will go out, else last edit.
 * @param c - Campaign row.
 * @returns Label for the date column.
 */
function dateLabel(c: CampaignRow): string {
  if (c.sentAt) return `Sent ${formatDateTimeShort(c.sentAt)}`;
  if (c.scheduledAt) return `Sends ${formatDateTimeShort(c.scheduledAt)}`;
  return `Edited ${formatDateTimeShort(c.updatedAt)}`;
}

/**
 * The sent / failed tally after the date, for an email that has gone out.
 * @param c - Campaign row.
 * @returns The " - N sent, M failed" suffix, or "" before sending.
 */
function tallyLabel(c: CampaignRow): string {
  if (c.status !== "sent" && c.status !== "failed") return "";
  return ` - ${c.sentCount} sent${c.failedCount > 0 ? `, ${c.failedCount} failed` : ""}`;
}

/**
 * Mailing list home screen.
 * @param props - Component props.
 * @param props.initial - Every campaign and preset, newest first.
 * @param props.subscribed - Contacts currently on the list.
 * @param props.unsubscribed - Contacts who have unsubscribed.
 * @returns Mailing view element.
 */
export function MailingView({
  initial,
  subscribed,
  unsubscribed,
}: {
  initial: CampaignRow[];
  subscribed: Recipient[];
  unsubscribed: Recipient[];
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState(initial);
  const [tab, setTab] = useState<Tab>("drafts");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CampaignRow | null>(null);

  const visible = rows.filter((r) => tabOf(r) === tab);

  /**
   * Creates a campaign and opens it in the editor.
   * @param body - POST body for the create route.
   * @param key - Busy marker while the request runs.
   */
  async function createAndOpen(body: Record<string, unknown>, key: string): Promise<void> {
    setBusyId(key);
    const res = await callApi<{ campaign: CampaignRow }>("/api/admin/mailing", "POST", body);
    if (!res.ok) {
      setBusyId(null);
      toast(res.error, { tone: "error" });
      return;
    }
    router.push(`/admin/mailing/${res.campaign.id}`);
  }

  /**
   * Copies an email into a new preset and stays on the list.
   * @param row - Email to copy.
   */
  async function saveAsPreset(row: CampaignRow): Promise<void> {
    setBusyId(`preset-${row.id}`);
    const res = await callApi<{ campaign: CampaignRow }>("/api/admin/mailing", "POST", {
      source: "copy",
      sourceId: row.id,
      asPreset: true,
    });
    setBusyId(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    setRows((prev) => [res.campaign, ...prev]);
    toast(`Saved "${res.campaign.name}" to your presets.`, { tone: "success" });
  }

  /** Deletes the email waiting in the confirm dialog. */
  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setBusyId(`delete-${deleting.id}`);
    const res = await callApi(`/api/admin/mailing/${deleting.id}`, "DELETE");
    setBusyId(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    const id = deleting.id;
    setRows((prev) => prev.filter((r) => r.id !== id));
    setDeleting(null);
  }

  const showStatus = tab !== "presets";

  /**
   * The buttons for one row, shared by the phone list and the desktop table.
   * @param row - Campaign row.
   * @returns The row's action buttons.
   */
  function rowActions(row: CampaignRow): React.ReactElement {
    return (
      <>
        {row.isPreset ? (
          <AdminButton
            size="xs"
            variant="outline"
            className={ROW_BUTTON_CLS}
            busy={busyId === `use-${row.id}`}
            onClick={() =>
              void createAndOpen({ source: "copy", sourceId: row.id }, `use-${row.id}`)
            }
          >
            Use
          </AdminButton>
        ) : (
          <>
            <AdminButton
              size="xs"
              variant="secondary"
              className={ROW_BUTTON_CLS}
              busy={busyId === `copy-${row.id}`}
              onClick={() =>
                void createAndOpen({ source: "copy", sourceId: row.id }, `copy-${row.id}`)
              }
            >
              Duplicate
            </AdminButton>
            <AdminButton
              size="xs"
              variant="secondary"
              className={ROW_BUTTON_CLS}
              busy={busyId === `preset-${row.id}`}
              onClick={() => void saveAsPreset(row)}
            >
              Save as preset
            </AdminButton>
          </>
        )}
        {row.status !== "sending" && (
          <AdminButton
            size="xs"
            variant="danger"
            className={ROW_BUTTON_CLS}
            onClick={() => setDeleting(row)}
          >
            Delete
          </AdminButton>
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ListToolbar
        className="mb-0"
        filters={
          <AdminTabs
            aria-label="Email stage"
            active={tab}
            onSelect={setTab}
            tabs={TABS.map((t) => {
              const count = rows.filter((r) => tabOf(r) === t.key).length;
              return {
                key: t.key,
                label: t.label,
                badge:
                  count > 0 ? (
                    <span className="font-semibold text-admin-muted">{count}</span>
                  ) : undefined,
              };
            })}
          />
        }
        actions={
          tab === "presets" ? (
            <AdminButton
              busy={busyId === "new-preset"}
              onClick={() => void createAndOpen({ source: "blank", asPreset: true }, "new-preset")}
            >
              <FaPlus className="h-3 w-3" aria-hidden /> New preset
            </AdminButton>
          ) : (
            <AdminButton
              busy={busyId === "blank"}
              onClick={() => void createAndOpen({ source: "blank" }, "blank")}
            >
              <FaPlus className="h-3 w-3" aria-hidden /> New email
            </AdminButton>
          )
        }
      />

      {visible.length === 0 ? (
        <Card padding="none">
          <EmptyState
            title={
              <>
                {tab === "drafts" && "No drafts. Start one with New email."}
                {tab === "scheduled" && "Nothing scheduled."}
                {tab === "sent" && "Nothing sent yet."}
                {tab === "presets" && "No presets. Save any email as a preset to reuse it."}
              </>
            }
          />
        </Card>
      ) : (
        <Card padding="none" className="overflow-hidden">
          {/* Phones: one stacked row per email. */}
          <ul className="flex flex-col divide-y divide-admin-border md:hidden">
            {visible.map((row) => {
              const pill = STATUS_PILL[row.status];
              return (
                <li
                  key={row.id}
                  className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/mailing/${row.id}`} className={LEDGER_LINK_CLS}>
                        {row.name}
                      </Link>
                      {!row.isPreset && <StatusPill tone={pill.tone}>{pill.label}</StatusPill>}
                    </div>
                    <p className="truncate text-sm text-admin-text-secondary">
                      {row.subject || <span className="italic">No subject yet</span>}
                    </p>
                    <p className="text-sm text-admin-muted">
                      {dateLabel(row)}
                      {tallyLabel(row)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">{rowActions(row)}</div>
                </li>
              );
            })}
          </ul>

          {/* From md: the data-table kit. */}
          <table className={cn(TABLE_CLS, "max-md:hidden")}>
            <thead className={THEAD_CLS}>
              <tr>
                <th className={TH_CLS}>Name</th>
                {showStatus && <th className={TH_CLS}>Status</th>}
                <th className={TH_CLS}>Date</th>
                <th className={cn(TH_CLS, "text-right")}>Actions</th>
              </tr>
            </thead>
            <tbody className={TBODY_CLS}>
              {visible.map((row) => {
                const pill = STATUS_PILL[row.status];
                return (
                  <tr key={row.id} className={ROW_CLS}>
                    <td className={cn(TD_CLS, "max-w-0 align-top")}>
                      <Link href={`/admin/mailing/${row.id}`} className={LEDGER_LINK_CLS}>
                        {row.name}
                      </Link>
                      <p className="truncate text-sm text-admin-text-secondary">
                        {row.subject || <span className="italic">No subject yet</span>}
                      </p>
                    </td>
                    {showStatus && (
                      <td className={cn(TD_CLS, "align-top")}>
                        {!row.isPreset && <StatusPill tone={pill.tone}>{pill.label}</StatusPill>}
                      </td>
                    )}
                    <td className={cn(TD_CLS, "align-top text-sm text-admin-muted")}>
                      {dateLabel(row)}
                      {tallyLabel(row)}
                    </td>
                    <td className={cn(TD_CLS, "align-top")}>
                      <div className="flex flex-wrap justify-end gap-2">{rowActions(row)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <SubscribersPanel initialSubscribed={subscribed} initialUnsubscribed={unsubscribed} />

      <ConfirmDialog
        open={deleting !== null}
        title={deleting?.isPreset ? "Delete this preset?" : "Delete this email?"}
        body={
          deleting?.sentAt
            ? "This also deletes the record of who it went to. It doesn't unsend anything."
            : "This can't be undone."
        }
        confirmLabel="Delete"
        tone="danger"
        busy={busyId === `delete-${deleting?.id}`}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
