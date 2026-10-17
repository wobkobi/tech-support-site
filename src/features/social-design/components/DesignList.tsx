"use client";
// src/features/social-design/components/DesignList.tsx
// The post maker's home: start a design (blank or from a template), and the designs
// and templates made so far, each with open, duplicate and delete.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import { KIND_LABEL, type DesignSummary } from "@/features/social-design/lib/design-row";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { FaCopy, FaPlus, FaTrash } from "react-icons/fa6";

/**
 * Design list.
 * @param props - Component props.
 * @param props.initial - Every design and template, last edited first.
 * @param props.forPost - Post a new design is for, when started from the composer.
 * @returns List element.
 */
export function DesignList({
  initial,
  forPost,
}: {
  initial: DesignSummary[];
  forPost: { id: string; name: string } | null;
}): React.ReactElement {
  const router = useRouter();
  const { toast } = useToast();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DesignSummary | null>(null);

  const templates = rows.filter((r) => r.isTemplate);
  const designs = rows.filter((r) => !r.isTemplate);

  /**
   * Creates a design and opens it in the editor.
   * @param body - POST body for the create route.
   * @param key - Busy marker while the request runs.
   */
  async function create(body: Record<string, unknown>, key: string): Promise<void> {
    setBusy(key);
    const res = await callApi<{ design: DesignSummary }>("/api/admin/social/designs", "POST", {
      ...body,
      ...(forPost ? { postId: forPost.id } : {}),
    });
    if (!res.ok) {
      setBusy(null);
      toast(res.error, { tone: "error" });
      return;
    }
    router.push(`/admin/social/design/${res.design.id}`);
  }

  /**
   * Copies a design next to the original without opening it.
   * @param row - Design to copy.
   */
  async function duplicate(row: DesignSummary): Promise<void> {
    setBusy(`dup-${row.id}`);
    const res = await callApi<{ design: DesignSummary }>("/api/admin/social/designs", "POST", {
      source: "copy",
      sourceId: row.id,
      asTemplate: row.isTemplate,
    });
    setBusy(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    setRows((prev) => [res.design, ...prev]);
  }

  /** Deletes the design waiting in the confirm dialog. */
  async function confirmDelete(): Promise<void> {
    if (!deleting) return;
    setBusy(`del-${deleting.id}`);
    const res = await callApi(`/api/admin/social/designs/${deleting.id}`, "DELETE");
    setBusy(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== deleting.id));
    setDeleting(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="design-start">
        <Card className="flex flex-col gap-3">
          <h2 id="design-start" className="text-lg font-semibold text-admin-text">
            {forPost ? `Start a design for "${forPost.name}"` : "Start a design"}
          </h2>
          <p className="-mt-2 text-sm text-admin-text-secondary">
            Start blank, or from a template already in your style. Every design makes all the sizes
            at once.
            {forPost && " When it's ready, Pictures > Use in post puts it on that post."}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <StartCard
              primary
              label="Blank design"
              hint="The brand backdrop and nothing else."
              busy={busy === "blank"}
              onClick={() => void create({ source: "blank" }, "blank")}
            />
            {templates.map((t) => (
              <StartCard
                key={t.id}
                label={t.name}
                hint={`${KIND_LABEL[t.kind]} template`}
                busy={busy === `use-${t.id}`}
                onClick={() => void create({ source: "copy", sourceId: t.id }, `use-${t.id}`)}
              />
            ))}
          </div>
        </Card>
      </section>

      <section aria-labelledby="design-mine">
        <Card className="flex flex-col gap-3">
          <h2 id="design-mine" className="text-lg font-semibold text-admin-text">
            Your designs
          </h2>
          {designs.length === 0 ? (
            <EmptyState
              title="No designs yet"
              body="Start from a template above, or a blank design."
            />
          ) : (
            <DesignGrid
              rows={designs}
              busy={busy}
              onDuplicate={(r) => void duplicate(r)}
              onDelete={setDeleting}
            />
          )}
        </Card>
      </section>

      {templates.length > 0 && (
        <section aria-labelledby="design-templates">
          <Card className="flex flex-col gap-3">
            <h2 id="design-templates" className="text-lg font-semibold text-admin-text">
              Templates
            </h2>
            <p className="-mt-2 text-sm text-admin-text-secondary">
              Open a template to change it. New designs started from it get the change.
            </p>
            <DesignGrid
              rows={templates}
              busy={busy}
              onDuplicate={(r) => void duplicate(r)}
              onDelete={setDeleting}
            />
          </Card>
        </section>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title={deleting?.isTemplate ? "Delete this template?" : "Delete this design?"}
        body={
          deleting?.postId
            ? "Its pictures stay on the post they were used in."
            : "This can't be undone."
        }
        confirmLabel="Delete"
        tone="danger"
        busy={busy === `del-${deleting?.id}`}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

/**
 * One start option.
 * @param props - Component props.
 * @param props.label - Button title.
 * @param props.hint - Line under the title.
 * @param props.primary - Whether this is the main option.
 * @param props.busy - Whether its design is being created.
 * @param props.onClick - Creates the design.
 * @returns Button element.
 */
function StartCard({
  label,
  hint,
  primary = false,
  busy,
  onClick,
}: {
  label: string;
  hint: string;
  primary?: boolean;
  busy: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
      className={
        primary
          ? "flex flex-col items-start gap-1 rounded-lg border-2 border-coquelicot-500 bg-coquelicot-50 p-3 text-left transition-colors hover:bg-coquelicot-100 disabled:opacity-60"
          : "flex flex-col items-start gap-1 rounded-lg border border-admin-border bg-admin-surface p-3 text-left transition-colors hover:bg-admin-bg disabled:opacity-60"
      }
    >
      <span className="flex items-center gap-2 font-semibold text-admin-text">
        {primary && <FaPlus aria-hidden className="size-3" />}
        {busy ? "Opening..." : label}
      </span>
      <span className="text-sm text-admin-text-secondary">{hint}</span>
    </button>
  );
}

/**
 * Grid of design cards.
 * @param props - Component props.
 * @param props.rows - Designs to show.
 * @param props.busy - Busy marker of the action in flight.
 * @param props.onDuplicate - Copies a design.
 * @param props.onDelete - Asks to delete a design.
 * @returns Grid element.
 */
function DesignGrid({
  rows,
  busy,
  onDuplicate,
  onDelete,
}: {
  rows: DesignSummary[];
  busy: string | null;
  onDuplicate: (row: DesignSummary) => void;
  onDelete: (row: DesignSummary) => void;
}): React.ReactElement {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex flex-col overflow-hidden rounded-lg border border-admin-border bg-admin-surface"
        >
          <Link
            href={`/admin/social/design/${r.id}`}
            // The 4:5 export fills a 4:5 box; with nothing exported a short strip
            // keeps the list compact.
            className={cn(
              "flex items-center justify-center bg-seasalt-100",
              r.thumbnailUrl ? "aspect-4/5" : "h-24",
            )}
          >
            {r.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- Blob thumbnail at a fixed small size; next/image adds nothing here.
              <img src={r.thumbnailUrl} alt="" className="size-full object-contain" />
            ) : (
              <span className="text-sm text-admin-muted">Not exported yet</span>
            )}
          </Link>
          <div className="flex items-start justify-between gap-2 p-3">
            <div className="min-w-0">
              <Link
                href={`/admin/social/design/${r.id}`}
                className="block truncate font-semibold text-admin-text hover:underline"
              >
                {r.name}
              </Link>
              <p className="text-sm text-admin-text-secondary">
                {KIND_LABEL[r.kind]} · {r.formatCount} sizes · {formatDateShort(r.updatedAt)}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <AdminButton
                variant="ghost"
                aria-label={`Duplicate ${r.name}`}
                title="Duplicate"
                busy={busy === `dup-${r.id}`}
                onClick={() => onDuplicate(r)}
              >
                <FaCopy aria-hidden className="size-3.5" />
              </AdminButton>
              <AdminButton
                variant="ghost"
                aria-label={`Delete ${r.name}`}
                title="Delete"
                onClick={() => onDelete(r)}
              >
                <FaTrash aria-hidden className="size-3.5" />
              </AdminButton>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
