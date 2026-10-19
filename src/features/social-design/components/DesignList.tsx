"use client";
// src/features/social-design/components/DesignList.tsx
// The post maker's home: start a design (blank or from a template) and manage the
// designs and templates made so far.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { adminChipClass } from "@/features/admin/components/ui/chip-classes";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { useToast } from "@/features/admin/components/ui/Toast";
import { callApi } from "@/features/mailing/lib/api-client";
import {
  DESIGN_KINDS,
  KIND_LABEL,
  type DesignKind,
  type DesignSummary,
} from "@/features/social-design/lib/design-row";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { useState } from "react";
import { FaCopy, FaPen, FaPlus, FaTrash } from "react-icons/fa6";

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
  const [kind, setKind] = useState<DesignKind | null>(null);

  const templates = rows.filter((r) => r.isTemplate);
  const designs = rows.filter((r) => !r.isTemplate);
  const kinds = DESIGN_KINDS.filter((k) => designs.some((r) => r.kind === k));
  // A filter left on a kind with no designs any more (the last one deleted) shows all.
  const shownKind = kind && kinds.includes(kind) ? kind : null;
  const shown = shownKind ? designs.filter((r) => r.kind === shownKind) : designs;

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

  /**
   * Renames a design.
   * @param row - Design to rename.
   * @param name - New name.
   * @returns Whether it saved.
   */
  async function rename(row: DesignSummary, name: string): Promise<boolean> {
    setBusy(`ren-${row.id}`);
    const res = await callApi<{ updatedAt: string }>(
      `/api/admin/social/designs/${row.id}`,
      "PATCH",
      { expectedUpdatedAt: row.updatedAt, name },
    );
    setBusy(null);
    if (!res.ok) {
      toast(res.error, { tone: "error" });
      return false;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, name: name.trim(), updatedAt: res.updatedAt } : r,
      ),
    );
    return true;
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
          {kinds.length > 1 && (
            <div
              role="group"
              aria-label="Show designs of one kind"
              className="flex flex-wrap gap-2"
            >
              <button
                type="button"
                aria-pressed={shownKind === null}
                onClick={() => setKind(null)}
                className={adminChipClass(shownKind === null)}
              >
                All
              </button>
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={shownKind === k}
                  onClick={() => setKind(k)}
                  className={adminChipClass(shownKind === k)}
                >
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          )}
          {designs.length === 0 ? (
            <EmptyState
              title="No designs yet"
              body="Start from a template above, or a blank design."
            />
          ) : (
            <DesignGrid
              rows={shown}
              busy={busy}
              onRename={rename}
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
              onRename={rename}
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
 * @param props.onRename - Saves a new name; resolves to whether it saved.
 * @param props.onDuplicate - Copies a design.
 * @param props.onDelete - Asks to delete a design.
 * @returns Grid element.
 */
function DesignGrid({
  rows,
  busy,
  onRename,
  onDuplicate,
  onDelete,
}: {
  rows: DesignSummary[];
  busy: string | null;
  onRename: (row: DesignSummary, name: string) => Promise<boolean>;
  onDuplicate: (row: DesignSummary) => void;
  onDelete: (row: DesignSummary) => void;
}): React.ReactElement {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  /**
   * Saves the name being typed; an empty or unchanged name just closes the box.
   * @param row - Design being renamed.
   */
  async function finishRename(row: DesignSummary): Promise<void> {
    const name = editing?.name.trim() ?? "";
    if (!name || name === row.name) {
      setEditing(null);
      return;
    }
    if (await onRename(row, name)) setEditing(null);
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {rows.map((r) => (
        <li
          key={r.id}
          className="flex flex-col overflow-hidden rounded-lg border border-admin-border bg-admin-surface"
        >
          <Link
            href={`/admin/social/design/${r.id}`}
            // 4:5 box for the export; a short strip when nothing is exported.
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
            <div className="min-w-0 flex-1">
              {editing?.id === r.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void finishRename(r);
                  }}
                  className="flex gap-1"
                >
                  <label className="sr-only" htmlFor={`rename-${r.id}`}>
                    Name
                  </label>
                  <input
                    id={`rename-${r.id}`}
                    autoFocus
                    value={editing.name}
                    maxLength={120}
                    onChange={(e) => setEditing({ id: r.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className={cn(ADMIN_INPUT_CLS, "h-9 min-w-0 flex-1 py-1")}
                  />
                  <AdminButton type="submit" size="sm" busy={busy === `ren-${r.id}`}>
                    Save
                  </AdminButton>
                </form>
              ) : (
                <Link
                  href={`/admin/social/design/${r.id}`}
                  className="block truncate font-semibold text-admin-text hover:underline"
                >
                  {r.name}
                </Link>
              )}
              <p className="text-sm text-admin-text-secondary">
                {KIND_LABEL[r.kind]} · {r.formatCount} sizes · {formatDateShort(r.updatedAt)}
              </p>
            </div>
            {/* Screen-reader text, not aria-label: a typed name in an attribute trips CodeQL. */}
            <div className={cn("flex shrink-0 gap-1", editing?.id === r.id && "hidden")}>
              <AdminButton
                variant="ghost"
                title="Rename"
                onClick={() => setEditing({ id: r.id, name: r.name })}
              >
                <FaPen aria-hidden className="size-3.5" />
                <span className="sr-only">Rename {r.name}</span>
              </AdminButton>
              <AdminButton
                variant="ghost"
                title="Duplicate"
                busy={busy === `dup-${r.id}`}
                onClick={() => onDuplicate(r)}
              >
                <FaCopy aria-hidden className="size-3.5" />
                <span className="sr-only">Duplicate {r.name}</span>
              </AdminButton>
              <AdminButton variant="ghost" title="Delete" onClick={() => onDelete(r)}>
                <FaTrash aria-hidden className="size-3.5" />
                <span className="sr-only">Delete {r.name}</span>
              </AdminButton>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
