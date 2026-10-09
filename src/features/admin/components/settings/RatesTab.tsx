"use client";
// src/features/admin/components/settings/RatesTab.tsx
// Rate editor on the Settings page: every RateConfig row grouped by kind (hourly base,
// per-hour adjustment, percentage adjustment, flat fee), edited in place with a per-row
// Save, plus an add-rate row and a reset to the shipped defaults. Talks straight to the
// /api/business/rates routes; rates aren't a settings group, so there's no save bar.

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import { ConfirmDialog } from "@/features/admin/components/ui/ConfirmDialog";
import { ADMIN_EYEBROW_CLS } from "@/features/admin/components/ui/field-classes";
import { useToast } from "@/features/admin/components/ui/Toast";
import { COMPACT_BUTTON_CLS } from "@/features/business/components/calculator/calculator-classes";
import { DEFAULT_RATE_ROWS } from "@/features/business/lib/pricing-policy";
import type { RateConfig } from "@/features/business/types/business";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useState } from "react";

type RateKind = "hourly" | "delta" | "percent" | "flat";

/** Section order and copy for each kind of rate. */
const SECTIONS: { kind: RateKind; title: string; blurb: string }[] = [
  {
    kind: "hourly",
    title: "Hourly rates",
    blurb: "The base rate every job starts from is marked Base.",
  },
  {
    kind: "delta",
    title: "Per-hour adjustments",
    blurb: "Added to (or taken off) the base rate. Use a minus for a discount, e.g. -30.",
  },
  {
    kind: "percent",
    title: "Percentage adjustments",
    blurb: "Multiply the rate after any per-hour adjustments, e.g. 25 for +25%.",
  },
  { kind: "flat", title: "Flat fees", blurb: "A fixed price, picked as a whole line." },
];

/** Options for the add-rate kind dropdown. */
const KIND_LABELS: Record<RateKind, string> = {
  hourly: "Hourly rate",
  delta: "Per-hour adjustment ($)",
  percent: "Percentage adjustment (%)",
  flat: "Flat fee",
};

/**
 * Labels the site looks rates up by. Renaming one would break that lookup, and the rates
 * API re-creates any of them that go missing, so they can't be renamed or deleted here.
 */
const BUILT_IN_LABELS = new Set<string>(DEFAULT_RATE_ROWS.map((r) => r.label));

/** One-line notes for built-in rates, keyed by lowercase label. */
const RATE_NOTES: Record<string, string> = {
  business: "Added for business clients.",
  "at home": "Bench repair at your place. One of At home, Remote or Phone per task.",
  remote: "Screen-share sessions. One of At home, Remote or Phone per task.",
  phone: "Help over the phone. One of At home, Remote or Phone per task.",
  "public holiday":
    "Charged on its own on public holidays, at the uplift on the Pricing tab. This % is only for ticking by hand.",
};

/**
 * Works out which kind of rate a row is from the one value field it sets.
 * @param r - Rate row.
 * @returns The row's kind.
 */
function kindOf(r: RateConfig): RateKind {
  if (r.ratePerHour !== null) return "hourly";
  if (r.percentDelta !== null) return "percent";
  if (r.hourlyDelta !== null) return "delta";
  return "flat";
}

/**
 * The row's amount as the operator types it: dollars, or whole percent for percentages.
 * @param r - Rate row.
 * @returns Amount as an input string.
 */
function amountOf(r: RateConfig): string {
  const kind = kindOf(r);
  if (kind === "hourly") return String(r.ratePerHour);
  if (kind === "delta") return String(r.hourlyDelta);
  // Stored as a fraction (0.25); round off float noise from the x100.
  if (kind === "percent") return String(Math.round((r.percentDelta ?? 0) * 10000) / 100);
  return String(r.flatRate ?? "");
}

/**
 * Builds the API body for a rate, setting only the value field its kind uses.
 * @param kind - Rate kind.
 * @param label - Rate name.
 * @param amount - Parsed amount (whole percent for percentages).
 * @param isDefault - Whether this is the base hourly rate.
 * @param unit - Unit to keep, for flat fees.
 * @returns JSON body for POST or PATCH.
 */
function rateBody(
  kind: RateKind,
  label: string,
  amount: number,
  isDefault: boolean,
  unit?: string,
): Record<string, unknown> {
  return {
    label,
    ratePerHour: kind === "hourly" ? amount : null,
    flatRate: kind === "flat" ? amount : null,
    hourlyDelta: kind === "delta" ? amount : null,
    percentDelta: kind === "percent" ? amount / 100 : null,
    unit: kind === "hourly" ? "hour" : kind === "flat" ? (unit ?? "each") : "modifier",
    isDefault: kind === "hourly" && isDefault,
  };
}

/**
 * Checks a typed amount for its kind.
 * @param kind - Rate kind.
 * @param raw - Typed amount.
 * @returns The parsed number, or an error message.
 */
function parseAmount(kind: RateKind, raw: string): number | string {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n)) return "Enter a number.";
  if ((kind === "hourly" || kind === "flat") && n < 0) return "Can't be below $0.";
  if (kind === "percent" && n <= -100) return "Must be above -100%.";
  return n;
}

/**
 * Formats dollars without trailing cents when whole.
 * @param n - Amount.
 * @returns e.g. "$120" or "$62.50".
 */
function money(n: number): string {
  const abs = Math.abs(n);
  const s = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return `${n < 0 ? "-" : ""}$${s}`;
}

/**
 * The resulting hourly rate for a row, so the operator sees what an adjustment comes to.
 * @param kind - Rate kind.
 * @param amount - Typed amount.
 * @param base - Base hourly rate.
 * @returns e.g. "= $120/hr", or "" when there's nothing to show.
 */
function effectiveLabel(kind: RateKind, amount: string, base: number | null): string {
  const n = Number(amount);
  if (base === null || amount.trim() === "" || !Number.isFinite(n)) return "";
  if (kind === "delta") return `= ${money(base + n)}/hr`;
  if (kind === "percent") return `= ${money(Math.round(base * (1 + n / 100) * 100) / 100)}/hr`;
  return "";
}

interface RowDraft {
  label: string;
  amount: string;
}

interface Props {
  initialRates: RateConfig[];
}

/**
 * Settings tab for editing rate rows in place.
 * @param props - Component props.
 * @param props.initialRates - Rate rows resolved server-side.
 * @returns Rates tab element.
 */
export function RatesTab({ initialRates }: Props): React.ReactElement {
  const { toast } = useToast();
  const [rates, setRates] = useState<RateConfig[]>(initialRates);
  // Unsaved edits by rate id; a row with no entry shows its saved values.
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newRate, setNewRate] = useState<{ kind: RateKind; label: string; amount: string }>({
    kind: "delta",
    label: "",
    amount: "",
  });
  const [adding, setAdding] = useState(false);

  const baseRow =
    rates.find((r) => r.isDefault && r.ratePerHour !== null) ??
    rates.find((r) => r.ratePerHour !== null);
  // Live: typing a new base rate updates every "= $X/hr" preview before saving.
  const base = baseRow
    ? Number(drafts[baseRow.id]?.amount ?? baseRow.ratePerHour) || (baseRow.ratePerHour ?? null)
    : null;

  /**
   * Returns the row as currently shown: its draft when edited, else its saved values.
   * @param r - Rate row.
   * @returns Label and amount strings.
   */
  const shown = (r: RateConfig): RowDraft =>
    drafts[r.id] ?? { label: r.label, amount: amountOf(r) };

  /**
   * Updates one field of a row's draft.
   * @param r - Rate row.
   * @param patch - Changed fields.
   */
  const editRow = (r: RateConfig, patch: Partial<RowDraft>): void => {
    setDrafts((d) => ({ ...d, [r.id]: { ...shown(r), ...patch } }));
  };

  /**
   * Drops a row's draft so it shows its saved values again.
   * @param id - Rate id.
   */
  const undoRow = (id: string): void => {
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  };

  /**
   * Checks a name is filled in and not used by another rate.
   * @param label - Proposed name.
   * @param exceptId - Rate being renamed, if any.
   * @returns An error message, or null when fine.
   */
  const labelError = (label: string, exceptId?: string): string | null => {
    const name = label.trim();
    if (!name) return "Give the rate a name.";
    const clash = rates.some(
      (r) => r.id !== exceptId && r.label.trim().toLowerCase() === name.toLowerCase(),
    );
    return clash ? `There's already a rate called ${name}.` : null;
  };

  /**
   * Re-reads the rate list, after a save hits a row that no longer exists.
   */
  async function refresh(): Promise<void> {
    try {
      const res = await fetch("/api/business/rates");
      const d = (await res.json()) as { ok?: boolean; rates?: RateConfig[] };
      if (d.ok && d.rates) setRates(d.rates);
    } catch {
      /* the next page load picks it up */
    }
  }

  /**
   * PATCHes a rate and folds the result into the list, clearing other defaults when it
   * became the base rate.
   * @param r - Rate row.
   * @param body - Fields to send.
   * @returns Whether the save went through.
   */
  async function patchRate(r: RateConfig, body: Record<string, unknown>): Promise<boolean> {
    setSavingId(r.id);
    try {
      const res = await fetch(`/api/business/rates/${r.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json()) as { ok?: boolean; rate?: RateConfig; error?: string };
      if (!res.ok || !d.rate) {
        toast(d.error ?? "Couldn't save the rate.", { tone: "error" });
        if (res.status === 404) await refresh();
        return false;
      }
      const saved = d.rate;
      setRates((prev) =>
        prev.map((x) =>
          x.id === saved.id ? saved : saved.isDefault ? { ...x, isDefault: false } : x,
        ),
      );
      return true;
    } catch {
      toast("Couldn't save the rate.", { tone: "error" });
      return false;
    } finally {
      setSavingId(null);
    }
  }

  /**
   * Saves a row's draft.
   * @param r - Rate row.
   */
  async function saveRow(r: RateConfig): Promise<void> {
    const draft = shown(r);
    const kind = kindOf(r);
    const nameErr = labelError(draft.label, r.id);
    const amount = parseAmount(kind, draft.amount);
    if (nameErr || typeof amount === "string") {
      toast(nameErr ?? (amount as string), { tone: "error" });
      return;
    }
    const ok = await patchRate(r, rateBody(kind, draft.label.trim(), amount, r.isDefault, r.unit));
    if (ok) {
      undoRow(r.id);
      toast(`${draft.label.trim()} saved.`, { tone: "success" });
    }
  }

  /**
   * Makes an hourly rate the base rate.
   * @param r - Hourly rate row.
   */
  async function makeBase(r: RateConfig): Promise<void> {
    if (await patchRate(r, { isDefault: true })) {
      toast(`${r.label} is now the base rate.`, { tone: "success" });
    }
  }

  /**
   * Adds the rate typed into the add row.
   */
  async function addRate(): Promise<void> {
    const nameErr = labelError(newRate.label);
    const amount = parseAmount(newRate.kind, newRate.amount);
    if (nameErr || typeof amount === "string") {
      toast(nameErr ?? (amount as string), { tone: "error" });
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/business/rates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(rateBody(newRate.kind, newRate.label.trim(), amount, false)),
      });
      const d = (await res.json()) as { ok?: boolean; rate?: RateConfig; error?: string };
      if (!res.ok || !d.rate) {
        toast(d.error ?? "Couldn't add the rate.", { tone: "error" });
        return;
      }
      const created = d.rate;
      setRates((prev) => [...prev, created]);
      setNewRate((p) => ({ ...p, label: "", amount: "" }));
      toast(`${created.label} added.`, { tone: "success" });
    } catch {
      toast("Couldn't add the rate.", { tone: "error" });
    } finally {
      setAdding(false);
    }
  }

  /**
   * Deletes the rate awaiting confirmation.
   */
  async function deleteRate(): Promise<void> {
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    if (!id) return;
    const res = await fetch(`/api/business/rates/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      const d = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
      toast(d.error ?? "Couldn't delete the rate.", { tone: "error" });
      await refresh();
      return;
    }
    setRates((prev) => prev.filter((r) => r.id !== id));
    undoRow(id);
  }

  /**
   * Wipes every rate and reseeds the shipped defaults.
   */
  async function resetRates(): Promise<void> {
    setConfirmResetOpen(false);
    setResetting(true);
    try {
      const res = await fetch("/api/business/rates", { method: "DELETE" });
      const d = (await res.json()) as { ok?: boolean; rates?: RateConfig[] };
      if (!res.ok || !d.rates) {
        toast("Couldn't reset the rates.", { tone: "error" });
        return;
      }
      setRates(d.rates);
      setDrafts({});
      toast("Rates reset to the defaults.", { tone: "success" });
    } catch {
      toast("Couldn't reset the rates.", { tone: "error" });
    } finally {
      setResetting(false);
    }
  }

  const deleting = rates.find((r) => r.id === confirmDeleteId);

  return (
    <div>
      {SECTIONS.map(({ kind, title, blurb }) => {
        const rows = rates
          .filter((r) => kindOf(r) === kind)
          .sort(
            (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.label.localeCompare(b.label),
          );
        if (rows.length === 0) return null;
        return (
          <section key={kind} className="mb-5">
            <h3 className={ADMIN_EYEBROW_CLS}>{title}</h3>
            <p className="mt-0.5 text-sm text-admin-muted">{blurb}</p>
            <div className="mt-2 divide-y divide-admin-border rounded-lg border border-admin-border">
              {rows.map((r) => {
                const row = shown(r);
                const dirty = r.id in drafts;
                const builtIn = BUILT_IN_LABELS.has(r.label);
                const note = RATE_NOTES[r.label.toLowerCase()];
                return (
                  <div key={r.id} className={cn("px-3 py-2", dirty && "bg-amber-50/60")}>
                    {/* Fixed columns so amounts line up whatever buttons a row has. */}
                    <form
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto_6rem_12rem]"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (dirty) void saveRow(r);
                      }}
                    >
                      <div className="min-w-0">
                        {builtIn ? (
                          <p
                            className="text-sm font-medium text-admin-text"
                            title="Built-in rate - the site looks it up by this name"
                          >
                            {r.label}
                          </p>
                        ) : (
                          <AdminInput
                            aria-label="Rate name"
                            value={row.label}
                            onChange={(e) => editRow(r, { label: e.target.value })}
                          />
                        )}
                        {note && <p className="text-sm leading-snug text-admin-faint">{note}</p>}
                      </div>
                      <span className="flex items-center gap-1 text-sm text-admin-muted">
                        <span className={cn(kind === "percent" && "invisible")}>$</span>
                        <AdminInput
                          aria-label={`${r.label} amount`}
                          type="number"
                          inputMode="decimal"
                          step="any"
                          value={row.amount}
                          onChange={(e) => editRow(r, { amount: e.target.value })}
                          className="w-24 text-right"
                        />
                        <span>{kind === "percent" ? "%" : kind === "flat" ? "" : "/hr"}</span>
                      </span>
                      <span className="text-sm text-admin-faint">
                        {effectiveLabel(kind, row.amount, base)}
                      </span>
                      <span className="flex flex-wrap items-center justify-end gap-2 gap-y-1">
                        {kind === "hourly" &&
                          (r.isDefault ? (
                            <span className="rounded-full bg-russian-violet/10 px-2.5 py-0.5 text-sm font-bold text-russian-violet">
                              Base
                            </span>
                          ) : (
                            <AdminButton
                              variant="ghost"
                              className={COMPACT_BUTTON_CLS}
                              disabled={savingId === r.id}
                              onClick={() => void makeBase(r)}
                            >
                              Make base
                            </AdminButton>
                          ))}
                        {/* Outline, not primary: a row Save can sit beside the danger
                            Delete, and Add rate stays the tab's one primary. */}
                        {dirty && (
                          <>
                            <AdminButton
                              variant="outline"
                              type="submit"
                              className={COMPACT_BUTTON_CLS}
                              busy={savingId === r.id}
                            >
                              Save
                            </AdminButton>
                            <AdminButton
                              variant="ghost"
                              className={COMPACT_BUTTON_CLS}
                              onClick={() => undoRow(r.id)}
                            >
                              Undo
                            </AdminButton>
                          </>
                        )}
                        {!builtIn && !r.isDefault && (
                          <AdminButton
                            variant="danger"
                            className={COMPACT_BUTTON_CLS}
                            onClick={() => setConfirmDeleteId(r.id)}
                          >
                            Delete
                          </AdminButton>
                        )}
                      </span>
                    </form>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Add a rate */}
      <section className="mb-5">
        <h3 className={ADMIN_EYEBROW_CLS}>Add a rate</h3>
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void addRate();
          }}
        >
          <AdminSelect
            aria-label="Kind of rate"
            value={newRate.kind}
            onChange={(e) => setNewRate((p) => ({ ...p, kind: e.target.value as RateKind }))}
            className="w-auto"
          >
            {(Object.keys(KIND_LABELS) as RateKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </AdminSelect>
          <AdminInput
            aria-label="New rate name"
            placeholder="Name, e.g. Urgent same-day"
            value={newRate.label}
            onChange={(e) => setNewRate((p) => ({ ...p, label: e.target.value }))}
            className="w-auto min-w-48 flex-1"
          />
          <span className="flex items-center gap-1 text-sm text-admin-muted">
            <span className={cn(newRate.kind === "percent" && "invisible")}>$</span>
            <AdminInput
              aria-label="New rate amount"
              type="number"
              inputMode="decimal"
              step="any"
              placeholder={
                newRate.kind === "delta" ? "+20" : newRate.kind === "percent" ? "25" : "0"
              }
              value={newRate.amount}
              onChange={(e) => setNewRate((p) => ({ ...p, amount: e.target.value }))}
              className="w-24 text-right"
            />
            <span>{newRate.kind === "percent" ? "%" : newRate.kind === "flat" ? "" : "/hr"}</span>
          </span>
          <span className="w-24 text-sm text-admin-faint">
            {effectiveLabel(newRate.kind, newRate.amount, base)}
          </span>
          <AdminButton size="sm" type="submit" busy={adding}>
            Add rate
          </AdminButton>
        </form>
      </section>

      <div className="flex items-center justify-between gap-3 border-t border-admin-border pt-3">
        <p className="text-sm text-admin-muted">
          Saved rates reach the pricing page, booking estimates and the calculator straight away.
        </p>
        <AdminButton
          size="sm"
          variant="secondary"
          busy={resetting}
          onClick={() => setConfirmResetOpen(true)}
        >
          Reset to defaults
        </AdminButton>
      </div>

      <ConfirmDialog
        open={confirmResetOpen}
        title="Reset all rates?"
        body="This deletes every rate and puts back the defaults (Standard, Business, At home, Remote, Phone, Public Holiday). Any rates you've added will be gone."
        confirmLabel="Reset rates"
        tone="danger"
        onConfirm={() => void resetRates()}
        onCancel={() => setConfirmResetOpen(false)}
      />
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title={`Delete ${deleting?.label ?? "this rate"}?`}
        body="Invoices already made keep their prices. The rate stops showing in the calculator."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => void deleteRate()}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
