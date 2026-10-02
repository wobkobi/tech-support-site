"use client";
// src/features/admin/components/settings/SettingsView.tsx
// Tabbed shell for the admin settings panel. Renders the group tab bar and the active
// tab's editor. Every settings group has a tab, plus a Rates tab for the RateConfig rows,
// which live in their own collection rather than a settings group.

import { SettingsSearch } from "@/features/admin/components/settings/SettingsSearch";
import { SettingsAllContext } from "@/features/admin/components/settings/useSettingsForm";
import type { RateConfig } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import { GROUP_META } from "@/shared/lib/settings/field-meta";
import type {
  AvailabilitySettings,
  CommsSettings,
  EstimatorSettings,
  IdentitySettings,
  PricingSettings,
  ReviewsSettings,
  SchedulingSettings,
  Settings,
  SettingsGroup,
  TaxSettings,
} from "@/shared/lib/settings/types";
import dynamic from "next/dynamic";
import type React from "react";
import { useEffect, useState } from "react";

/**
 * Placeholder shown while a tab editor chunk loads.
 * @returns Loading placeholder element.
 */
function TabLoading(): React.ReactElement {
  return <p className="py-8 text-center text-sm text-admin-faint">Loading…</p>;
}

// Tab editors load on demand: only the active tab's chunk ships, instead of
// bundling all nine editors into the settings page's first load.
const AvailabilityTab = dynamic(
  () =>
    import("@/features/admin/components/settings/AvailabilityTab").then((m) => m.AvailabilityTab),
  { loading: TabLoading },
);
const CommsTab = dynamic(
  () => import("@/features/admin/components/settings/CommsTab").then((m) => m.CommsTab),
  { loading: TabLoading },
);
const EstimatorTab = dynamic(
  () => import("@/features/admin/components/settings/EstimatorTab").then((m) => m.EstimatorTab),
  { loading: TabLoading },
);
const IdentityTab = dynamic(
  () => import("@/features/admin/components/settings/IdentityTab").then((m) => m.IdentityTab),
  { loading: TabLoading },
);
const PricingTab = dynamic(
  () => import("@/features/admin/components/settings/PricingTab").then((m) => m.PricingTab),
  { loading: TabLoading },
);
const ReviewsTab = dynamic(
  () => import("@/features/admin/components/settings/ReviewsTab").then((m) => m.ReviewsTab),
  { loading: TabLoading },
);
const SchedulingTab = dynamic(
  () => import("@/features/admin/components/settings/SchedulingTab").then((m) => m.SchedulingTab),
  { loading: TabLoading },
);
const TaxTab = dynamic(
  () => import("@/features/admin/components/settings/TaxTab").then((m) => m.TaxTab),
  { loading: TabLoading },
);
const RatesTab = dynamic(
  () => import("@/features/admin/components/settings/RatesTab").then((m) => m.RatesTab),
  { loading: TabLoading },
);

/** A settings group, or the Rates tab. */
export type SettingsTabKey = SettingsGroup | "rates";

/** Title and blurb for the Rates tab, which has no entry in GROUP_META. */
const RATES_META = {
  title: "Rates",
  blurb: "Your hourly rate and the adjustments the calculator and pricing page use.",
};

/** Tab order shown in the settings bar. */
const TAB_ORDER: SettingsTabKey[] = [
  "availability",
  "pricing",
  "rates",
  "estimator",
  "identity",
  "tax",
  "comms",
  "scheduling",
  "reviews",
];

interface Props {
  /** Tab to open on, e.g. from the calculator's Manage rates link. */
  initialTab?: SettingsTabKey;
  rates: RateConfig[];
  availability: AvailabilitySettings;
  availabilityDefaults: AvailabilitySettings;
  pricing: PricingSettings;
  pricingDefaults: PricingSettings;
  estimator: EstimatorSettings;
  estimatorDefaults: EstimatorSettings;
  comms: CommsSettings;
  commsDefaults: CommsSettings;
  reviews: ReviewsSettings;
  reviewsDefaults: ReviewsSettings;
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
 * @param props.initialTab - Tab to open on; defaults to availability.
 * @param props.rates - Rate rows for the Rates tab.
 * @param props.availability - Resolved current availability settings.
 * @param props.availabilityDefaults - Code default availability settings.
 * @param props.pricing - Resolved current pricing settings.
 * @param props.pricingDefaults - Code default pricing settings.
 * @param props.estimator - Resolved current estimator settings.
 * @param props.estimatorDefaults - Code default estimator settings.
 * @param props.comms - Resolved current comms settings.
 * @param props.commsDefaults - Code default comms settings.
 * @param props.reviews - Resolved current reviews settings.
 * @param props.reviewsDefaults - Code default reviews settings.
 * @param props.identity - Resolved current identity settings.
 * @param props.identityDefaults - Code default identity settings.
 * @param props.tax - Resolved current tax settings.
 * @param props.taxDefaults - Code default tax settings.
 * @param props.scheduling - Resolved current scheduling settings.
 * @param props.schedulingDefaults - Code default scheduling settings.
 * @returns Settings view element.
 */
export function SettingsView({
  initialTab,
  rates,
  availability,
  availabilityDefaults,
  pricing,
  pricingDefaults,
  estimator,
  estimatorDefaults,
  comms,
  commsDefaults,
  reviews,
  reviewsDefaults,
  identity,
  identityDefaults,
  tax,
  taxDefaults,
  scheduling,
  schedulingDefaults,
}: Props): React.ReactElement {
  const [active, setActive] = useState<SettingsTabKey>(initialTab ?? "availability");
  const [focusTarget, setFocusTarget] = useState<{ id: string; nonce: number } | null>(null);
  const meta = active === "rates" ? RATES_META : GROUP_META[active];

  /**
   * Jumps to a field from search: switches to its tab and queues a focus.
   * @param group - Target settings group.
   * @param fieldKey - Field id to focus once the tab has rendered.
   */
  const handleJump = (group: SettingsGroup, fieldKey: string): void => {
    setActive(group);
    setFocusTarget({ id: fieldKey, nonce: Date.now() });
  };

  // After a search jump, scroll + focus the target once the (possibly just-switched) tab
  // has rendered. Search indexes the full meta key but a tab renders nested fields under
  // the last segment alone, so "cancellation.callOutFee" must also try "callOutFee" or
  // nested fields would switch tabs without ever scrolling.
  useEffect(() => {
    if (!focusTarget) return;
    const t = setTimeout(() => {
      const short = focusTarget.id.split(".").pop() ?? focusTarget.id;
      const el = document.getElementById(focusTarget.id) ?? document.getElementById(short) ?? null;
      if (el) {
        const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "center", behavior: prefersReduced ? "auto" : "smooth" });
        el.focus({ preventScroll: true });
      }
    }, 60);
    return () => clearTimeout(t);
  }, [focusTarget]);

  // Full current settings for the live cross-setting guardrail check in each tab.
  const current: Settings = {
    availability,
    pricing,
    estimator,
    comms,
    reviews,
    identity,
    tax,
    scheduling,
  };

  return (
    <SettingsAllContext.Provider value={current}>
      <div>
        <SettingsSearch onJump={handleJump} />

        {/* Tab bar - scrolls sideways on phones, wraps from md up so every tab shows. */}
        <div className="mb-3 flex gap-x-1 overflow-x-auto border-b border-admin-border md:flex-wrap md:overflow-visible">
          {TAB_ORDER.map((tab) => {
            const isActive = tab === active;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActive(tab)}
                className={cn(
                  "-mb-px border-b-2 px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                  isActive
                    ? "border-russian-violet text-russian-violet"
                    : "border-transparent text-admin-muted hover:text-admin-text",
                )}
              >
                {tab === "rates" ? RATES_META.title : GROUP_META[tab].title}
              </button>
            );
          })}
        </div>

        {/* The active tab already names the section, so the card leads with its blurb. */}
        <div className="rounded-xl border border-admin-border bg-admin-surface p-4 shadow-sm sm:px-5">
          <p className="text-sm text-admin-muted">{meta.blurb}</p>
          <div className="mt-1">
            {active === "rates" ? (
              <div className="mt-3">
                <RatesTab initialRates={rates} />
              </div>
            ) : active === "availability" ? (
              <AvailabilityTab initial={availability} defaults={availabilityDefaults} />
            ) : active === "pricing" ? (
              <PricingTab initial={pricing} defaults={pricingDefaults} />
            ) : active === "estimator" ? (
              <EstimatorTab initial={estimator} defaults={estimatorDefaults} />
            ) : active === "identity" ? (
              <IdentityTab
                initial={identity}
                defaults={identityDefaults}
                bookableSchedule={availability.schedule}
              />
            ) : active === "comms" ? (
              <CommsTab initial={comms} defaults={commsDefaults} />
            ) : active === "reviews" ? (
              <ReviewsTab initial={reviews} defaults={reviewsDefaults} />
            ) : active === "tax" ? (
              <TaxTab initial={tax} defaults={taxDefaults} />
            ) : active === "scheduling" ? (
              <SchedulingTab initial={scheduling} defaults={schedulingDefaults} />
            ) : null}
          </div>
        </div>
      </div>
    </SettingsAllContext.Provider>
  );
}
