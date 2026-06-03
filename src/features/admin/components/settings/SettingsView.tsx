"use client";
// src/features/admin/components/settings/SettingsView.tsx
/**
 * @file SettingsView.tsx
 * @description Tabbed shell for the admin settings panel. Renders the group tab
 * bar and the active tab's editor. Tabs are added group by group; ones not yet
 * built show a placeholder noting they're still managed in code.
 */

import { useState } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";
import { GROUP_META } from "@/shared/lib/settings/field-meta";
import type { PricingSettings, SettingsGroup } from "@/shared/lib/settings/types";
import { PricingTab } from "@/features/admin/components/settings/PricingTab";

/** Tab order shown in the settings bar. */
const TAB_ORDER: SettingsGroup[] = [
  "availability",
  "pricing",
  "identity",
  "tax",
  "comms",
  "holds",
  "scheduling",
  "reviews",
];

/** Groups with a working editor; the rest render the placeholder. */
const IMPLEMENTED: ReadonlySet<SettingsGroup> = new Set<SettingsGroup>(["pricing"]);

interface Props {
  pricing: PricingSettings;
  pricingDefaults: PricingSettings;
}

/**
 * Settings tab bar + active editor.
 * @param props - Component props.
 * @param props.pricing - Resolved current pricing settings.
 * @param props.pricingDefaults - Code default pricing settings.
 * @returns Settings view element.
 */
export function SettingsView({ pricing, pricingDefaults }: Props): React.ReactElement {
  const [active, setActive] = useState<SettingsGroup>("pricing");
  const meta = GROUP_META[active];

  return (
    <div>
      {/* Tab bar - horizontally scrollable on phones. */}
      <div className={cn("mb-6 flex gap-1 overflow-x-auto border-b border-slate-200")}>
        {TAB_ORDER.map((group) => {
          const isActive = group === active;
          const ready = IMPLEMENTED.has(group);
          return (
            <button
              key={group}
              type="button"
              onClick={() => setActive(group)}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "border-russian-violet text-russian-violet"
                  : "border-transparent text-slate-500 hover:text-slate-700",
                !ready && "italic text-slate-400",
              )}
            >
              {GROUP_META[group].title}
            </button>
          );
        })}
      </div>

      <div className={cn("rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6")}>
        <h2 className={cn("text-russian-violet text-lg font-bold")}>{meta.title}</h2>
        <p className={cn("mt-1 text-sm text-slate-500")}>{meta.blurb}</p>
        <div className={cn("mt-4")}>
          {active === "pricing" ? (
            <PricingTab initial={pricing} defaults={pricingDefaults} />
          ) : (
            <p className={cn("py-8 text-center text-sm text-slate-400")}>
              This section is still managed in code - its editor is coming in a later step.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
