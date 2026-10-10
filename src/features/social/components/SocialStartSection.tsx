"use client";
// src/features/social/components/SocialStartSection.tsx
// "Start a post" at the top of the Social page: a blank post or any preset, as roomy
// cards while nothing is open and a compact row of buttons beside a post being written.
// In preset editing the same buttons open each preset instead.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import { TEXT_ACTION_CLS } from "@/features/business/components/calculator/calculator-classes";
import { firstLine } from "@/features/social/components/social-list-helpers";
import type { SocialPostRow } from "@/features/social/lib/post-row";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { FaPen, FaPlus } from "react-icons/fa6";

/**
 * Start section.
 * @param props - Component props.
 * @param props.headingRef - The heading, focused when the composer closes.
 * @param props.editingPresets - Whether the buttons edit presets instead of starting posts.
 * @param props.onToggleEditing - Switches preset editing on or off.
 * @param props.hasOpen - Whether a post is open in the composer below.
 * @param props.openId - Id of the open post, to mark the preset being edited.
 * @param props.presets - Presets, oldest first.
 * @param props.isBusy - Whether a button's post is being created or loaded.
 * @param props.onCreate - Creates a post or preset and opens it.
 * @param props.onOpenPost - Opens an existing preset.
 * @returns Section element.
 */
export function SocialStartSection({
  headingRef,
  editingPresets,
  onToggleEditing,
  hasOpen,
  openId,
  presets,
  isBusy,
  onCreate,
  onOpenPost,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  editingPresets: boolean;
  onToggleEditing: () => void;
  hasOpen: boolean;
  openId: string | null;
  presets: SocialPostRow[];
  isBusy: (key: string) => boolean;
  onCreate: (body: Record<string, unknown>, key: string) => void;
  onOpenPost: (id: string) => void;
}): React.ReactElement {
  return (
    <section aria-labelledby="social-start">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            ref={headingRef}
            id="social-start"
            tabIndex={-1}
            className="text-lg font-semibold text-admin-text focus:outline-none"
          >
            {editingPresets ? "Edit presets" : "Start a post"}
          </h2>
          <button type="button" onClick={onToggleEditing} className={TEXT_ACTION_CLS}>
            {editingPresets ? "Done" : "Edit presets"}
          </button>
        </div>
        <p className={cn("-mt-2 text-sm text-admin-text-secondary", hasOpen && "hidden sm:block")}>
          {editingPresets
            ? "Pick a preset to change its wording, or add a new one."
            : "Start blank, or from a preset that has the wording ready to change."}
        </p>
        <div
          className={
            // Roomy cards while nothing is open, since starting a post is the whole
            // page then; a compact row of buttons once a post is being written.
            // On a phone the compact row scrolls sideways, keeping the post in view.
            hasOpen
              ? "-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
              : "grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
          }
        >
          {editingPresets ? (
            <StartButton
              compact={hasOpen}
              icon={<FaPlus aria-hidden className="size-3" />}
              label="New preset"
              busy={isBusy("new-preset")}
              onClick={() => onCreate({ source: "blank", asPreset: true }, "new-preset")}
            />
          ) : (
            <StartButton
              compact={hasOpen}
              primary
              icon={<FaPlus aria-hidden className="size-3" />}
              label="Blank post"
              hint="Write it from scratch."
              busy={isBusy("blank")}
              onClick={() => onCreate({ source: "blank" }, "blank")}
            />
          )}
          {presets.map((p) => (
            <StartButton
              key={p.id}
              compact={hasOpen}
              icon={editingPresets ? <FaPen aria-hidden className="size-3" /> : undefined}
              label={p.name}
              hint={firstLine(p.body)}
              current={editingPresets && p.id === openId}
              busy={isBusy(`use-${p.id}`) || (editingPresets && isBusy(p.id))}
              onClick={() =>
                editingPresets
                  ? onOpenPost(p.id)
                  : onCreate({ source: "copy", sourceId: p.id }, `use-${p.id}`)
              }
            />
          ))}
        </div>
      </Card>
    </section>
  );
}

/**
 * One way to start a post: a roomy card with a hint while nothing is open, or a
 * compact button beside a post being written.
 * @param props - Component props.
 * @param props.label - What it starts.
 * @param props.hint - A line on what's in it; only shown on the roomy card.
 * @param props.icon - Optional leading icon.
 * @param props.primary - Highlight it as the main choice.
 * @param props.compact - Show the compact button.
 * @param props.current - Whether it's the preset open in the composer.
 * @param props.busy - Whether it's being created.
 * @param props.onClick - Click handler.
 * @returns Start button element.
 */
function StartButton({
  label,
  hint,
  icon,
  primary = false,
  compact,
  current = false,
  busy,
  onClick,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  primary?: boolean;
  compact: boolean;
  current?: boolean;
  busy: boolean;
  onClick: () => void;
}): React.ReactElement {
  if (compact) {
    // Outline rather than the coquelicot primary: beside an open post, Post now is the
    // page's one primary action.
    return (
      <AdminButton
        size="sm"
        variant={primary ? "outline" : "secondary"}
        busy={busy}
        aria-current={current ? "true" : undefined}
        className={cn("shrink-0", current && "border-russian-violet text-russian-violet")}
        onClick={onClick}
      >
        {icon}
        {label}
      </AdminButton>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      aria-current={current ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-h-20 flex-col items-start gap-1 rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-60",
        primary
          ? "border-russian-violet bg-russian-violet text-white hover:bg-russian-violet/90"
          : "border-admin-border bg-admin-bg hover:border-russian-violet/50",
        current && "border-russian-violet",
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-2 font-semibold",
          primary ? "text-white" : "text-admin-text",
        )}
      >
        {icon}
        {busy ? "Opening..." : label}
      </span>
      {hint && (
        <span
          className={cn(
            "line-clamp-2 text-sm",
            primary ? "text-white/80" : "text-admin-text-secondary",
          )}
        >
          {hint}
        </span>
      )}
    </button>
  );
}
