"use client";
// src/features/business/components/PromoForm.tsx
// The new/edit promo form card. Markup only: the form state, validation and save live in
// PromosView, which passes them down.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { PromoAdvancedOptions } from "@/features/business/components/PromoAdvancedOptions";
import {
  PromoPricePreview,
  type PromoPreviewRates,
} from "@/features/business/components/PromoPricePreview";
import {
  AMOUNT_LABEL,
  previewPromo,
  type FormState,
  type PromoType,
} from "@/features/business/lib/promo-form";
import { summariseForBanner } from "@/features/business/lib/promos";
import { cn } from "@/shared/lib/cn";
import React, { useId } from "react";

/** Props for {@link PromoForm}. */
interface PromoFormProps {
  /** Current form state. */
  form: FormState;
  /** Form state setter. */
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  /** Id of the promo being edited, or null for a new one. */
  editingId: string | null;
  /** True while the save is in flight. */
  busy: boolean;
  /** Validation or save error to show above the preview. */
  error: string | null;
  /** Whether the form is unfolded on phones; lg+ always shows it. */
  formOpen: boolean;
  /** Whether the advanced options are unfolded. */
  advancedOpen: boolean;
  /** Receives the advanced section's new open state. */
  onAdvancedOpenChange: (open: boolean) => void;
  /** Ref the row Edit buttons scroll into view. */
  formRef: React.RefObject<HTMLFormElement | null>;
  /** Saves the form. */
  onSubmit: (e: React.SyntheticEvent<HTMLFormElement>) => void;
  /** Clears the form and leaves edit mode. */
  onCancel: () => void;
  /** Live rates the price preview discounts. */
  rates: PromoPreviewRates;
}

/**
 * New/edit promo form in a card, folded away on phones until opened.
 * @param props - Component props.
 * @param props.form - Current form state.
 * @param props.setForm - Form state setter.
 * @param props.editingId - Id of the promo being edited, or null.
 * @param props.busy - True while the save is in flight.
 * @param props.error - Validation or save error.
 * @param props.formOpen - Whether the form is unfolded on phones.
 * @param props.advancedOpen - Whether the advanced options are unfolded.
 * @param props.onAdvancedOpenChange - Receives the advanced section's open state.
 * @param props.formRef - Ref the row Edit buttons scroll into view.
 * @param props.onSubmit - Saves the form.
 * @param props.onCancel - Clears the form and leaves edit mode.
 * @param props.rates - Live rates for the price preview.
 * @returns The form card.
 */
export function PromoForm({
  form,
  setForm,
  editingId,
  busy,
  error,
  formOpen,
  advancedOpen,
  onAdvancedOpenChange,
  formRef,
  onSubmit,
  onCancel,
  rates,
}: PromoFormProps): React.ReactElement {
  const id = useId();

  return (
    <Card className={cn(!formOpen && "max-lg:hidden")}>
      <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
        <CardHeader title={editingId ? "Edit promo" : "New promo"} />

        <div className="grid gap-3 sm:grid-cols-2">
          <AdminField label="Title" htmlFor={`${id}-title`}>
            <AdminInput
              id={`${id}-title`}
              type="text"
              required
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="e.g. Soft launch"
            />
          </AdminField>
          <AdminField label="Description (optional)" htmlFor={`${id}-description`}>
            <AdminInput
              id={`${id}-description`}
              type="text"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Shown on the pricing page"
            />
          </AdminField>
          <AdminField label="Starts" htmlFor={`${id}-start`}>
            <AdminInput
              id={`${id}-start`}
              type="date"
              required
              value={form.startDate}
              onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
            />
          </AdminField>
          <AdminField label="Ends (inclusive)" htmlFor={`${id}-end`}>
            <AdminInput
              id={`${id}-end`}
              type="date"
              required
              value={form.endDate}
              onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
            />
          </AdminField>
          <AdminField label="Type" htmlFor={`${id}-type`}>
            <AdminSelect
              id={`${id}-type`}
              value={form.type}
              onChange={(e) =>
                setForm((p) => ({ ...p, type: e.target.value as PromoType, amount: "" }))
              }
            >
              <option value="flat">Flat $/hr</option>
              <option value="percent">% off the job</option>
              <option value="fixed">$ off the job</option>
              <option value="travel">% off travel</option>
            </AdminSelect>
          </AdminField>
          <AdminField label={AMOUNT_LABEL[form.type]} htmlFor={`${id}-amount`}>
            <AdminInput
              id={`${id}-amount`}
              type="number"
              required
              min="0"
              step="0.01"
              // A travel discount may be the full 100%; a job discount of 100%
              // would be a free job, which is a mistake rather than an offer.
              max={form.type === "percent" ? 99 : form.type === "travel" ? 100 : undefined}
              value={form.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
              placeholder={form.type === "flat" ? "50" : form.type === "fixed" ? "20" : "20"}
            />
          </AdminField>
        </div>

        <div className="flex flex-wrap items-start gap-4">
          <AdminField
            label="Who gets it"
            htmlFor={`${id}-kind`}
            hint={
              form.kind === "code"
                ? "Never shown on the banner or the pricing page - only someone with the code gets it."
                : "Applies to every visitor and shows on the site-wide banner."
            }
          >
            <AdminSelect
              id={`${id}-kind`}
              value={form.kind}
              onChange={(e) =>
                setForm((p) => ({ ...p, kind: e.target.value as "automatic" | "code" }))
              }
              className="w-56"
            >
              <option value="automatic">Everyone (automatic)</option>
              <option value="code">Only with a code</option>
            </AdminSelect>
          </AdminField>

          {form.kind === "code" && (
            <AdminField
              label="Code"
              htmlFor={`${id}-code`}
              hint="Letters, numbers and dashes. 3 to 32 characters."
            >
              <AdminInput
                id={`${id}-code`}
                type="text"
                required
                value={form.code}
                // Uppercased as it is typed, because that is how it is stored
                // and compared - what the operator sees is what a customer
                // has to enter.
                onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                placeholder="SPRING25"
                maxLength={32}
                autoComplete="off"
                spellCheck={false}
                className="w-48 tracking-wider uppercase"
              />
            </AdminField>
          )}
        </div>

        <PromoAdvancedOptions
          form={form}
          setForm={setForm}
          open={advancedOpen}
          onOpenChange={onAdvancedOpenChange}
        />

        <AdminCheckbox
          checked={form.isActive}
          onChange={(checked) => setForm((p) => ({ ...p, isActive: checked }))}
          label="Active (uncheck to keep the promo on file but pause it)"
        />

        {error && (
          <p className="rounded-md bg-coquelicot-500/10 px-3 py-2 text-sm text-coquelicot-700">
            {error}
          </p>
        )}

        {/* Rendered by summariseForBanner, the same function the real banner
            calls, so the preview cannot drift from what ships. Across four
            discount types plus tiers, a spend floor and a weekday restriction,
            the wording is no longer obvious from the fields above. */}
        {(() => {
          const preview = previewPromo(form);
          if (!preview) return null;
          return (
            <div className="rounded-lg border border-admin-border bg-admin-bg px-4 py-3">
              <p className="text-sm font-medium text-admin-muted">Customers will see</p>
              <p className="mt-1 text-[0.9375rem] font-semibold text-admin-text">
                ⚡ {summariseForBanner(preview)}
              </p>
              {form.kind === "code" && (
                <p className="mt-1 text-sm text-admin-muted">
                  Not on the banner - a code promo is only ever shown to someone who enters
                  {form.code ? ` ${form.code}` : " the code"}.
                </p>
              )}
            </div>
          );
        })()}

        {(() => {
          const preview = previewPromo(form);
          return preview ? <PromoPricePreview promo={preview} rates={rates} /> : null;
        })()}

        <div className="flex gap-2">
          <AdminButton type="submit" busy={busy}>
            {editingId ? "Update promo" : "Create promo"}
          </AdminButton>
          <AdminButton
            type="button"
            variant="secondary"
            onClick={onCancel}
            className={cn(!editingId && "lg:hidden")}
          >
            Cancel
          </AdminButton>
        </div>
      </form>
    </Card>
  );
}
