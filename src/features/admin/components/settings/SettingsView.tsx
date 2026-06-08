"use client";
// src/features/admin/components/settings/SettingsView.tsx
/**
 * @file SettingsView.tsx
 * @description Tabbed shell for the admin settings panel. Renders the group tab
 * bar and the active tab's editor. Tabs are added group by group; ones not yet
 * built show a placeholder noting they're still managed in code.
 */

import { AvailabilityTab } from "@/features/admin/components/settings/AvailabilityTab";
import { CommsTab } from "@/features/admin/components/settings/CommsTab";
import { HoldsTab } from "@/features/admin/components/settings/HoldsTab";
import { IdentityTab } from "@/features/admin/components/settings/IdentityTab";
import { PricingTab } from "@/features/admin/components/settings/PricingTab";
import { ReviewsTab } from "@/features/admin/components/settings/ReviewsTab";
import { SchedulingTab } from "@/features/admin/components/settings/SchedulingTab";
import { SettingsSearch } from "@/features/admin/components/settings/SettingsSearch";
import { TaxTab } from "@/features/admin/components/settings/TaxTab";
import { SettingsAllContext } from "@/features/admin/components/settings/useSettingsForm";
import { cn } from "@/shared/lib/cn";
import { GROUP_META } from "@/shared/lib/settings/field-meta";
import type {
  AvailabilitySettings,
  CommsSettings,
  HoldsSettings,
  IdentitySettings,
  PricingSettings,
  ReviewsSettings,
  SchedulingSettings,
  Settings,
  SettingsGroup,
  TaxSettings,
} from "@/shared/lib/settings/types";
import type React from "react";
import { useEffect, useState } from "react";

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
const IMPLEMENTED: ReadonlySet<SettingsGroup> = new Set<SettingsGroup>([
  "availability",
  "pricing",
  "identity",
  "tax",
  "comms",
  "reviews",
  "holds",
  "scheduling",
]);

interface Props {
  availability: AvailabilitySettings;
  availabilityDefaults: AvailabilitySettings;
  pricing: PricingSettings;
  pricingDefaults: PricingSettings;
  comms: CommsSettings;
  commsDefaults: CommsSettings;
  reviews: ReviewsSettings;
  reviewsDefaults: ReviewsSettings;
  holds: HoldsSettings;
  holdsDefaults: HoldsSettings;
  identity: IdentitySettings;
  identityDefaults: IdentitySettings;
  tax: TaxSettings;
  taxDefaults: TaxSettings;
  scheduling: SchedulingSettings;
  schedulingDefaults: SchedulingSettings;
}

/**
 * Settings tab bar + active editor.
 * @param props - Component props.
 * @param props.availability - Resolved current availability settings.
 * @param props.availabilityDefaults - Code default availability settings.
 * @param props.pricing - Resolved current pricing settings.
 * @param props.pricingDefaults - Code default pricing settings.
 * @param props.comms - Resolved current comms settings.
 * @param props.commsDefaults - Code default comms settings.
 * @param props.reviews - Resolved current reviews settings.
 * @param props.reviewsDefaults - Code default reviews settings.
 * @param props.holds - Resolved current holds settings.
 * @param props.holdsDefaults - Code default holds settings.
 * @param props.identity - Resolved current identity settings.
 * @param props.identityDefaults - Code default identity settings.
 * @param props.tax - Resolved current tax settings.
 * @param props.taxDefaults - Code default tax settings.
 * @param props.scheduling - Resolved current scheduling settings.
 * @param props.schedulingDefaults - Code default scheduling settings.
 * @returns Settings view element.
 */
export function SettingsView({
  availability,
  availabilityDefaults,
  pricing,
  pricingDefaults,
  comms,
  commsDefaults,
  reviews,
  reviewsDefaults,
  holds,
  holdsDefaults,
  identity,
  identityDefaults,
  tax,
  taxDefaults,
  scheduling,
  schedulingDefaults,
}: Props): React.ReactElement {
  const [active, setActive] = useState<SettingsGroup>("availability");
  const [focusTarget, setFocusTarget] = useState<{ id: string; nonce: number } | null>(null);
  const meta = GROUP_META[active];

  /**
   * Jumps to a field from search: switches to its tab and queues a focus.
   * @param group - Target settings group.
   * @param fieldKey - Field id to focus once the tab has rendered.
   */
  const handleJump = (group: SettingsGroup, fieldKey: string): void => {
    setActive(group);
    setFocusTarget({ id: fieldKey, nonce: Date.now() });
  };

  // After a search jump, scroll the target field into view + focus it once the
  // (possibly just-switched) tab has rendered. Field id === meta key for most
  // fields; nested keys gracefully fall back to just the tab switch.
  useEffect(() => {
    if (!focusTarget) return;
    const t = setTimeout(() => {
      const el = document.getElementById(focusTarget.id);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.focus();
      }
    }, 60);
    return () => clearTimeout(t);
  }, [focusTarget]);

  // Full current settings for the live cross-setting guardrail check in each tab.
  const current: Settings = {
    availability,
    pricing,
    comms,
    reviews,
    holds,
    identity,
    tax,
    scheduling,
  };

  return (
    <SettingsAllContext.Provider value={current}>
      <div>
        <SettingsSearch onJump={handleJump} />

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
            {active === "availability" ? (
              <AvailabilityTab initial={availability} defaults={availabilityDefaults} />
            ) : active === "pricing" ? (
              <PricingTab initial={pricing} defaults={pricingDefaults} />
            ) : active === "identity" ? (
              <IdentityTab initial={identity} defaults={identityDefaults} />
            ) : active === "comms" ? (
              <CommsTab initial={comms} defaults={commsDefaults} />
            ) : active === "reviews" ? (
              <ReviewsTab initial={reviews} defaults={reviewsDefaults} />
            ) : active === "holds" ? (
              <HoldsTab initial={holds} defaults={holdsDefaults} />
            ) : active === "tax" ? (
              <TaxTab initial={tax} defaults={taxDefaults} />
            ) : active === "scheduling" ? (
              <SchedulingTab initial={scheduling} defaults={schedulingDefaults} />
            ) : (
              <p className={cn("py-8 text-center text-sm text-slate-400")}>
                This section is still managed in code - its editor is coming in a later step.
              </p>
            )}
          </div>
        </div>
      </div>
    </SettingsAllContext.Provider>
  );
}
