"use client";
// src/features/admin/components/settings/IdentityTab.tsx
/**
 * @description Editor for the business identity group: contact details, the
 * unified base address (which also drives the travel origin + SEO), payment
 * terms, GST number, bank account, home region, and the SEO service area
 * (radius + served suburbs). Sensitive fields (GST number, bank account) are
 * masked with a reveal toggle.
 */

import {
  closeLabel,
  FieldShell,
  HourSelect,
  NumberField,
  SettingsTabBody,
  TextField,
} from "@/features/admin/components/settings/SettingsFields";
import { SettingsFooter } from "@/features/admin/components/settings/SettingsFooter";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import AddressAutocomplete from "@/features/booking/components/AddressAutocomplete";
import { hourLabel } from "@/features/booking/lib/booking";
import { cn } from "@/shared/lib/cn";
import { IDENTITY_FIELD_META } from "@/shared/lib/settings/field-meta";
import type {
  BaseAddress,
  IdentitySettings,
  PublishedHours,
  WeeklySchedule,
} from "@/shared/lib/settings/types";
import type React from "react";

interface Props {
  initial: IdentitySettings;
  defaults: IdentitySettings;
  /** The real bookable schedule, shown alongside the published-hours override. */
  bookableSchedule: WeeklySchedule;
}

/**
 * Section heading inside the identity tab.
 * @param props - Component props.
 * @param props.children - Heading text.
 * @returns Heading element.
 */
function SectionHeading({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <h3 className="mt-6 text-xs font-bold tracking-wide text-russian-violet uppercase">
      {children}
    </h3>
  );
}

/**
 * Business identity settings tab.
 * @param props - Component props.
 * @param props.initial - Server-resolved current identity settings.
 * @param props.defaults - Code default identity settings.
 * @param props.bookableSchedule - The real bookable weekly schedule.
 * @returns Identity tab element.
 */
export function IdentityTab({ initial, defaults, bookableSchedule }: Props): React.ReactElement {
  const form = useSettingsForm("identity", initial, defaults);
  const { draft, setDraft, fieldErrors } = form;
  const m = IDENTITY_FIELD_META;

  /**
   * Merges an identity patch into the draft.
   * @param patch - Partial identity fields.
   * @returns void
   */
  const set = (patch: Partial<IdentitySettings>): void => setDraft((p) => ({ ...p, ...patch }));

  /**
   * Merges a base-address patch into the draft.
   * @param patch - Partial base-address fields.
   * @returns void
   */
  const setAddr = (patch: Partial<BaseAddress>): void =>
    setDraft((p) => ({ ...p, baseAddress: { ...p.baseAddress, ...patch } }));

  /**
   * Patches the published-hours override; a no-op while the override is off.
   * @param patch - Partial published-hours fields.
   * @returns void
   */
  const setPublished = (patch: Partial<PublishedHours>): void =>
    setDraft((p) =>
      p.publishedHours ? { ...p, publishedHours: { ...p.publishedHours, ...patch } } : p,
    );

  // Widest window anyone can actually book, used to seed the override (so
  // switching it on starts as a no-op) and to show what stays bookable.
  const openDays = Object.values(bookableSchedule).filter((d) => d.enabled);
  const bookableOpen = openDays.length > 0 ? Math.min(...openDays.map((d) => d.open)) : 10;
  const bookableClose = openDays.length > 0 ? Math.max(...openDays.map((d) => d.close)) : 20;
  const published = draft.publishedHours;

  return (
    <SettingsTabBody changed={form.changedPaths}>
      <SectionHeading>Contact</SectionHeading>
      <div className="divide-y divide-admin-border">
        <TextField
          id="name"
          meta={m.name}
          value={draft.name}
          customised={draft.name !== defaults.name}
          onChange={(v) => set({ name: v })}
        />
        <TextField
          id="company"
          meta={m.company}
          value={draft.company}
          customised={draft.company !== defaults.company}
          onChange={(v) => set({ company: v })}
        />
        <TextField
          id="email"
          type="email"
          meta={m.email}
          value={draft.email}
          error={fieldErrors.email}
          customised={draft.email !== defaults.email}
          onChange={(v) => set({ email: v })}
        />
        <TextField
          id="phone"
          type="tel"
          meta={m.phone}
          value={draft.phone}
          customised={draft.phone !== defaults.phone}
          onChange={(v) => set({ phone: v })}
        />
        <TextField
          id="phoneTel"
          meta={m.phoneTel}
          value={draft.phoneTel}
          customised={draft.phoneTel !== defaults.phoneTel}
          onChange={(v) => set({ phoneTel: v })}
        />
        <TextField
          id="website"
          meta={m.website}
          value={draft.website}
          customised={draft.website !== defaults.website}
          onChange={(v) => set({ website: v })}
        />
        <TextField
          id="location"
          meta={m.location}
          value={draft.location}
          customised={draft.location !== defaults.location}
          onChange={(v) => set({ location: v })}
        />
      </div>

      <SectionHeading>Base address (travel origin + map)</SectionHeading>
      <div className="divide-y divide-admin-border">
        <FieldShell
          id="baseAddress.line"
          meta={m["baseAddress.line"]}
          customised={draft.baseAddress.line !== defaults.baseAddress.line}
        >
          <AddressAutocomplete
            id="baseAddress.line"
            value={draft.baseAddress.line}
            fetchDetails
            aria-label="Base address"
            placeholder="Start typing the base address..."
            inputClassName="w-full rounded-lg border border-admin-border-strong px-3 py-2.5 text-base focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
            onChange={(v) => setAddr({ line: v })}
            onPlaceSelected={(p) =>
              setAddr({
                line: p.formattedAddress,
                ...(p.locality ? { locality: p.locality } : {}),
                ...(p.postcode ? { postcode: p.postcode } : {}),
                ...(p.lat != null ? { lat: Math.round(p.lat * 1e6) / 1e6 } : {}),
                ...(p.lng != null ? { lng: Math.round(p.lng * 1e6) / 1e6 } : {}),
              })
            }
          />
        </FieldShell>
        <TextField
          id="baseAddress.locality"
          meta={m["baseAddress.locality"]}
          value={draft.baseAddress.locality}
          customised={draft.baseAddress.locality !== defaults.baseAddress.locality}
          onChange={(v) => setAddr({ locality: v })}
        />
        <TextField
          id="baseAddress.postcode"
          meta={m["baseAddress.postcode"]}
          value={draft.baseAddress.postcode}
          customised={draft.baseAddress.postcode !== defaults.baseAddress.postcode}
          onChange={(v) => setAddr({ postcode: v })}
        />
        <NumberField
          id="baseAddress.lat"
          meta={m["baseAddress.lat"]}
          value={draft.baseAddress.lat}
          nullable
          customised={draft.baseAddress.lat !== defaults.baseAddress.lat}
          onChange={(v) => setAddr({ lat: v })}
        />
        <NumberField
          id="baseAddress.lng"
          meta={m["baseAddress.lng"]}
          value={draft.baseAddress.lng}
          nullable
          customised={draft.baseAddress.lng !== defaults.baseAddress.lng}
          onChange={(v) => setAddr({ lng: v })}
        />
      </div>

      <SectionHeading>Invoicing</SectionHeading>
      <div className="divide-y divide-admin-border">
        <NumberField
          id="paymentTermsDays"
          meta={m.paymentTermsDays}
          value={draft.paymentTermsDays}
          min={0}
          error={fieldErrors.paymentTermsDays}
          customised={draft.paymentTermsDays !== defaults.paymentTermsDays}
          onChange={(v) => set({ paymentTermsDays: v ?? 0 })}
        />
        <TextField
          id="startDateIso"
          type="date"
          meta={m.startDateIso}
          value={draft.startDateIso.slice(0, 10)}
          customised={draft.startDateIso !== defaults.startDateIso}
          onChange={(v) =>
            set({ startDateIso: v ? new Date(`${v}T00:00:00Z`).toISOString() : draft.startDateIso })
          }
        />
        <TextField
          id="gstNumber"
          secret
          meta={m.gstNumber}
          value={draft.gstNumber}
          customised={draft.gstNumber !== defaults.gstNumber}
          onChange={(v) => set({ gstNumber: v })}
        />
        <TextField
          id="bankAccount"
          secret
          meta={m.bankAccount}
          value={draft.bankAccount}
          customised={draft.bankAccount !== defaults.bankAccount}
          onChange={(v) => set({ bankAccount: v })}
        />
        <TextField
          id="homeRegion"
          meta={m.homeRegion}
          value={draft.homeRegion}
          customised={draft.homeRegion !== defaults.homeRegion}
          onChange={(v) => set({ homeRegion: v })}
        />
      </div>

      <SectionHeading>Service area (SEO)</SectionHeading>
      <div className="divide-y divide-admin-border">
        <NumberField
          id="serviceRadiusKm"
          meta={m.serviceRadiusKm}
          value={draft.serviceRadiusKm}
          min={1}
          max={500}
          error={fieldErrors.serviceRadiusKm}
          customised={draft.serviceRadiusKm !== defaults.serviceRadiusKm}
          onChange={(v) => set({ serviceRadiusKm: v ?? 1 })}
        />
        <FieldShell
          id="servedSuburbs"
          meta={m.servedSuburbs}
          customised={draft.servedSuburbs.join("\n") !== defaults.servedSuburbs.join("\n")}
        >
          <textarea
            id="servedSuburbs"
            value={draft.servedSuburbs.join("\n")}
            rows={6}
            placeholder="One suburb per line"
            onChange={(e) => set({ servedSuburbs: e.target.value.split("\n") })}
            className="w-full rounded-lg border border-admin-border-strong px-3 py-2 text-base focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
          />
        </FieldShell>
      </div>

      <SectionHeading>Published hours (SEO)</SectionHeading>
      <div className="divide-y divide-admin-border">
        <FieldShell
          id="publishedHours"
          meta={m.publishedHours}
          error={fieldErrors["publishedHours.open"] ?? fieldErrors["publishedHours.close"]}
          customised={published !== null}
        >
          <div className="flex flex-wrap items-center gap-2 text-sm text-admin-text-secondary">
            <button
              type="button"
              role="switch"
              aria-checked={published !== null}
              aria-label="Override published hours"
              onClick={() =>
                set({
                  publishedHours: published ? null : { open: bookableOpen, close: bookableClose },
                })
              }
              className={cn(
                "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
                published ? "bg-russian-violet" : "bg-admin-border-strong",
              )}
            >
              <span
                className={cn(
                  "inline-block h-5 w-5 rounded-full bg-admin-surface shadow transition-[translate]",
                  published ? "translate-x-6" : "translate-x-1",
                )}
              />
            </button>
            {published ? (
              <>
                <span>Tell Google</span>
                <HourSelect
                  value={published.open}
                  from={0}
                  to={23}
                  ariaLabel="Published opening time"
                  onChange={(h) => setPublished({ open: h })}
                />
                <span>to</span>
                <HourSelect
                  value={published.close}
                  from={1}
                  to={24}
                  close
                  ariaLabel="Published closing time"
                  onChange={(h) => setPublished({ close: h })}
                />
              </>
            ) : (
              <span>Off - your real bookable hours are published.</span>
            )}
          </div>
          {published && (
            <p className="mt-2 text-xs text-admin-muted">
              Bookings still run {hourLabel(bookableOpen)} to {closeLabel(bookableClose)}, set on
              the Availability tab. Only the advertised listing changes.
            </p>
          )}
        </FieldShell>
      </div>

      <SectionHeading>Email signature</SectionHeading>
      <div className="divide-y divide-admin-border">
        <FieldShell
          id="emailSignature"
          meta={m.emailSignature}
          error={fieldErrors.emailSignature}
          customised={draft.emailSignature !== defaults.emailSignature}
        >
          <textarea
            id="emailSignature"
            value={draft.emailSignature}
            rows={5}
            spellCheck={false}
            placeholder={"**{name}** · Owner / Technician\n{phone} · {email}"}
            onChange={(e) => set({ emailSignature: e.target.value })}
            className="w-full rounded-lg border border-admin-border-strong px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
          />
        </FieldShell>
      </div>

      <SettingsFooter form={form} />

      <SettingsHistory group="identity" onRestore={(v: IdentitySettings) => setDraft(v)} />
    </SettingsTabBody>
  );
}
