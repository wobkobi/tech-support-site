"use client";
// src/features/admin/components/settings/IdentityTab.tsx
/**
 * @file IdentityTab.tsx
 * @description Editor for the business identity group: contact details, the
 * unified base address (which also drives the travel origin + SEO once wired),
 * payment terms, GST number, bank account, and invoice prefix. Sensitive fields
 * (GST number, bank account) are masked with a reveal toggle. Saving stores to
 * the DB; the public/invoice/email consumers read these in the follow-up step.
 */

import { NumberField, TextField } from "@/features/admin/components/settings/SettingsFields";
import { SettingsHistory } from "@/features/admin/components/settings/SettingsHistory";
import { useSettingsForm } from "@/features/admin/components/settings/useSettingsForm";
import { cn } from "@/shared/lib/cn";
import { IDENTITY_FIELD_META } from "@/shared/lib/settings/field-meta";
import type { BaseAddress, IdentitySettings } from "@/shared/lib/settings/types";
import type React from "react";

interface Props {
  initial: IdentitySettings;
  defaults: IdentitySettings;
}

/**
 * Section heading inside the identity tab.
 * @param props - Component props.
 * @param props.children - Heading text.
 * @returns Heading element.
 */
function SectionHeading({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <h3 className={cn("mt-6 text-xs font-bold tracking-wide text-russian-violet uppercase")}>
      {children}
    </h3>
  );
}

/**
 * Business identity settings tab.
 * @param props - Component props.
 * @param props.initial - Server-resolved current identity settings.
 * @param props.defaults - Code default identity settings.
 * @returns Identity tab element.
 */
export function IdentityTab({ initial, defaults }: Props): React.ReactElement {
  const form = useSettingsForm("identity", initial, defaults);
  const { draft, setDraft, dirty, saving, fieldErrors, blocks, savedAt } = form;
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

  return (
    <div>
      <SectionHeading>Contact</SectionHeading>
      <div className={cn("divide-y divide-slate-100")}>
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
      <div className={cn("divide-y divide-slate-100")}>
        <TextField
          id="addrLine"
          meta={m["baseAddress.line"]}
          value={draft.baseAddress.line}
          customised={draft.baseAddress.line !== defaults.baseAddress.line}
          onChange={(v) => setAddr({ line: v })}
        />
        <TextField
          id="addrLocality"
          meta={m["baseAddress.locality"]}
          value={draft.baseAddress.locality}
          customised={draft.baseAddress.locality !== defaults.baseAddress.locality}
          onChange={(v) => setAddr({ locality: v })}
        />
        <TextField
          id="addrPostcode"
          meta={m["baseAddress.postcode"]}
          value={draft.baseAddress.postcode}
          customised={draft.baseAddress.postcode !== defaults.baseAddress.postcode}
          onChange={(v) => setAddr({ postcode: v })}
        />
        <NumberField
          id="addrLat"
          meta={m["baseAddress.lat"]}
          value={draft.baseAddress.lat}
          nullable
          customised={draft.baseAddress.lat !== defaults.baseAddress.lat}
          onChange={(v) => setAddr({ lat: v })}
        />
        <NumberField
          id="addrLng"
          meta={m["baseAddress.lng"]}
          value={draft.baseAddress.lng}
          nullable
          customised={draft.baseAddress.lng !== defaults.baseAddress.lng}
          onChange={(v) => setAddr({ lng: v })}
        />
      </div>

      <SectionHeading>Invoicing</SectionHeading>
      <div className={cn("divide-y divide-slate-100")}>
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
          id="invoicePrefix"
          meta={m.invoicePrefix}
          value={draft.invoicePrefix}
          error={fieldErrors.invoicePrefix}
          customised={draft.invoicePrefix !== defaults.invoicePrefix}
          onChange={(v) => set({ invoicePrefix: v })}
        />
        <TextField
          id="homeRegion"
          meta={m.homeRegion}
          value={draft.homeRegion}
          customised={draft.homeRegion !== defaults.homeRegion}
          onChange={(v) => set({ homeRegion: v })}
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

      <SettingsHistory group="identity" onRestore={(v: IdentitySettings) => setDraft(v)} />
    </div>
  );
}
