"use client";
// src/features/admin/components/settings/SchedulingTab.tsx
/**
 * @file SchedulingTab.tsx
 * @description Editor for the advanced scheduling group: the travel-block
 * heuristics used by the calendar travel engine (rounding buffer, minimum home
 * dwell, travel-back departure buffer, smart-origin lookahead). Marked advanced
 * - the defaults are sensible and most operators never need to touch these.
 */

import { NumberField } from "@/features/admin/components/settings/SettingsFields";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { cn } from "@/shared/lib/cn";
import { SCHEDULING_FIELD_META } from "@/shared/lib/settings/field-meta";
import type { SchedulingSettings } from "@/shared/lib/settings/types";
import type React from "react";

interface Props {
  initial: SchedulingSettings;
  defaults: SchedulingSettings;
}

/**
 * Advanced scheduling settings tab.
 * @param props - Component props.
 * @param props.initial - Server-resolved current scheduling settings.
 * @param props.defaults - Code default scheduling settings.
 * @returns Scheduling tab element.
 */
export function SchedulingTab({ initial, defaults }: Props): React.ReactElement {
  const form = useSettingsForm("scheduling", initial, defaults);
  const { draft, setDraft, dirty, saving, fieldErrors, blocks, savedAt } = form;
  const m = SCHEDULING_FIELD_META;

  /**
   * Merges a scheduling patch into the draft.
   * @param patch - Partial scheduling fields.
   * @returns void
   */
  const set = (patch: Partial<SchedulingSettings>): void => setDraft((p) => ({ ...p, ...patch }));

  return (
    <div>
      <div className={cn("mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3")}>
        <p className={cn("text-sm text-amber-800")}>
          Advanced. These tune the calendar travel-block engine. The defaults work well - only
          change them if you know you need to, and use &quot;Reset to defaults&quot; if unsure.
        </p>
      </div>
      <div className={cn("divide-y divide-slate-100")}>
        <NumberField
          id="travelRoundBufferMin"
          meta={m.travelRoundBufferMin}
          value={draft.travelRoundBufferMin}
          min={0}
          error={fieldErrors.travelRoundBufferMin}
          customised={draft.travelRoundBufferMin !== defaults.travelRoundBufferMin}
          onChange={(v) => set({ travelRoundBufferMin: v ?? 0 })}
        />
        <NumberField
          id="minHomeDwellMin"
          meta={m.minHomeDwellMin}
          value={draft.minHomeDwellMin}
          min={0}
          error={fieldErrors.minHomeDwellMin}
          customised={draft.minHomeDwellMin !== defaults.minHomeDwellMin}
          onChange={(v) => set({ minHomeDwellMin: v ?? 0 })}
        />
        <NumberField
          id="travelBackDepartureBufferMin"
          meta={m.travelBackDepartureBufferMin}
          value={draft.travelBackDepartureBufferMin}
          min={0}
          error={fieldErrors.travelBackDepartureBufferMin}
          customised={draft.travelBackDepartureBufferMin !== defaults.travelBackDepartureBufferMin}
          onChange={(v) => set({ travelBackDepartureBufferMin: v ?? 0 })}
        />
        <NumberField
          id="smartOriginLookaheadHours"
          meta={m.smartOriginLookaheadHours}
          value={draft.smartOriginLookaheadHours}
          min={0}
          max={24}
          error={fieldErrors.smartOriginLookaheadHours}
          customised={draft.smartOriginLookaheadHours !== defaults.smartOriginLookaheadHours}
          onChange={(v) => set({ smartOriginLookaheadHours: v ?? 0 })}
        />
      </div>

      {/* Guardrail blocks */}
      {blocks.length > 0 && (
        <div className={cn("mt-6 rounded-lg border border-red-200 bg-red-50 p-4")}>
          <p className={cn("text-sm font-semibold text-red-700")}>Can&apos;t save yet:</p>
          <ul className={cn("mt-1 list-disc space-y-1 pl-5 text-sm text-red-700")}>
            {blocks.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Save bar */}
      <div className={cn("mt-6 flex items-center gap-3")}>
        <button
          type="button"
          onClick={() => void form.save()}
          disabled={!dirty || saving}
          className={cn(
            "rounded-lg bg-russian-violet px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50",
          )}
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
        <button
          type="button"
          onClick={form.resetToDefault}
          disabled={saving}
          className={cn(
            "rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50",
          )}
        >
          Reset to defaults
        </button>
        {dirty && !saving && <span className={cn("text-sm text-slate-400")}>Unsaved changes</span>}
        {!dirty && savedAt && (
          <span className={cn("text-sm font-medium text-emerald-600")}>Saved</span>
        )}
      </div>

      <SettingsHistory group="scheduling" onRestore={(v: SchedulingSettings) => setDraft(v)} />
    </div>
  );
}
