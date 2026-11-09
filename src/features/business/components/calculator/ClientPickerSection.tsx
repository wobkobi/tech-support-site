"use client";
// src/features/business/components/calculator/ClientPickerSection.tsx
// Right-rail "Client" card: inline contact search, then a Name/Company/Custom control
// once picked. Editing the picked name switches to Custom and offers a contact rename.

import { AdminCheckbox } from "@/features/admin/components/ui/AdminCheckbox";
import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import {
  SEGMENTED_GROUP_CLS,
  segmentedButtonClass,
} from "@/features/admin/components/ui/chip-classes";
import { ADMIN_CHECKBOX_CLS, ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { TEXT_ACTION_CLS } from "@/features/business/components/calculator/calculator-classes";
import { goldCardOffText } from "@/features/business/lib/business";
import type { GoogleContact } from "@/features/business/types/business";
import { filterContacts } from "@/features/contacts/lib/contact-search";
import { EmailInput } from "@/shared/components/EmailInput";
import { PhoneInput } from "@/shared/components/PhoneInput";
import { cn } from "@/shared/lib/cn";
import { displayNZPhone } from "@/shared/lib/normalise-phone";
import type React from "react";
import { useMemo, useRef, useState } from "react";

type AddressMode = "name" | "company" | "custom";

interface Props {
  clientName: string;
  onClientNameChange: (value: string) => void;
  clientEmail: string;
  onClientEmailChange: (value: string) => void;
  clientPhone: string;
  onClientPhoneChange: (value: string) => void;
  pickedContactName: string | null;
  pickedContactCompany: string | null;
  addressMode: AddressMode;
  onAddressModeChange: (mode: AddressMode) => void;
  /** The edited name a picked contact could be renamed to, or null when there is none. */
  renameOffer: string | null;
  renameContact: boolean;
  onRenameContactChange: (value: boolean) => void;
  goldCard: boolean;
  onGoldCardChange: (value: boolean) => void;
  /** The Gold Card share off labour, or null to hide the box (no rate row, or a cancellation). */
  goldCardPercent: number | null;
  contacts: GoogleContact[];
  onSelectContact: (contact: GoogleContact) => void;
  onClearContact: () => void;
}

const MAX_SUGGESTIONS = 6;

/**
 * Right-rail "Client" card. Name searches saved contacts; a pick fills name, email and mobile
 * and shows the Name/Company/Custom control.
 * @param props - Component props.
 * @param props.clientName - Current Name value.
 * @param props.onClientNameChange - Name setter; fires on every keystroke.
 * @param props.clientEmail - Current Email value.
 * @param props.onClientEmailChange - Email setter.
 * @param props.clientPhone - Current Mobile value, as typed.
 * @param props.onClientPhoneChange - Mobile setter.
 * @param props.pickedContactName - Picked contact's name, or null.
 * @param props.pickedContactCompany - Picked contact's company (drives Company availability).
 * @param props.addressMode - Current segmented-control selection.
 * @param props.onAddressModeChange - Flips the segmented control + updates clientName.
 * @param props.renameOffer - Edited name the picked contact could take, or null.
 * @param props.renameContact - Whether saving the invoice renames the contact.
 * @param props.onRenameContactChange - Ticks or unticks the rename.
 * @param props.goldCard - Whether the client holds a Gold Card.
 * @param props.onGoldCardChange - Ticks or unticks the Gold Card.
 * @param props.goldCardPercent - Gold Card share off labour, or null to hide the box.
 * @param props.contacts - All saved Google contacts (loaded once by the parent).
 * @param props.onSelectContact - Fires when the operator clicks a suggestion or commits one via Enter.
 * @param props.onClearContact - Fires when the operator clears the picked contact.
 * @returns Client card element.
 */
export function ClientPickerSection({
  clientName,
  onClientNameChange,
  clientEmail,
  onClientEmailChange,
  clientPhone,
  onClientPhoneChange,
  pickedContactName,
  pickedContactCompany,
  addressMode,
  onAddressModeChange,
  renameOffer,
  renameContact,
  onRenameContactChange,
  goldCard,
  onGoldCardChange,
  goldCardPercent,
  contacts,
  onSelectContact,
  onClearContact,
}: Props): React.ReactElement {
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autocomplete only before a pick.
  const searching = pickedContactName === null;

  const suggestions = useMemo(() => {
    if (!searching || !focused || !clientName.trim()) return [];
    return filterContacts(contacts, clientName).slice(0, MAX_SUGGESTIONS);
  }, [searching, focused, clientName, contacts]);

  // Names held by more than one contact: those suggestions also show the phone, so two
  // "Mary"s with no email or company never look identical.
  const sharedNames = useMemo(() => {
    const seen = new Set<string>();
    const shared = new Set<string>();
    for (const c of contacts) {
      const key = c.name.trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) shared.add(key);
      seen.add(key);
    }
    return shared;
  }, [contacts]);

  /**
   * Commits a suggestion, cancelling the pending blur-close so the click lands.
   * @param c - The chosen contact.
   */
  function pick(c: GoogleContact): void {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    onSelectContact(c);
    setFocused(false);
  }

  /**
   * Keyboard nav on the Name input while suggestions are open.
   * @param e - Keyboard event.
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      const target = suggestions[highlight];
      if (target) {
        e.preventDefault();
        pick(target);
      }
    } else if (e.key === "Escape") {
      setFocused(false);
    }
  }

  return (
    <Card className="space-y-3">
      {/* No rule under the heading: Address to and the fields read as one block with it. */}
      <CardHeader
        title="Client"
        className="mb-0 items-center border-b-0 pb-0"
        actions={
          pickedContactName && (
            <button type="button" onClick={onClearContact} className={TEXT_ACTION_CLS}>
              x Clear
            </button>
          )
        }
      />
      {pickedContactName && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-admin-text-secondary">Address to:</span>
          {/* One of three, so the same joined control as Invoice | Quote and Cash | Bank. */}
          <div role="group" aria-label="Address to" className={SEGMENTED_GROUP_CLS}>
            {(["name", "company", "custom"] as const).map((mode) => {
              const disabled = mode === "company" && !pickedContactCompany;
              const active = addressMode === mode;
              const label = mode === "name" ? "Name" : mode === "company" ? "Company" : "Custom";
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={disabled}
                  onClick={() => onAddressModeChange(mode)}
                  title={disabled ? "Picked contact has no company" : undefined}
                  aria-pressed={active}
                  className={segmentedButtonClass(active)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {/* Name and email side by side on 2xl, mobile on the next row; the rename tick keeps
          its place after the name in the DOM but drops to a row of its own under both. */}
      <div className="grid gap-3 2xl:grid-cols-2">
        <div className="relative">
          <AdminInput
            type="text"
            placeholder="Name"
            value={clientName}
            onChange={(e) => {
              // A hand edit becomes Custom; picking Name again restores the contact's name.
              if (!searching && addressMode !== "custom") onAddressModeChange("custom");
              onClientNameChange(e.target.value);
              setHighlight(0);
            }}
            onFocus={() => setFocused(true)}
            // Close-on-blur deferred so a click on a suggestion still fires.
            onBlur={() => {
              blurTimerRef.current = setTimeout(() => setFocused(false), 150);
            }}
            onKeyDown={onKeyDown}
          />
          {suggestions.length > 0 && (
            <div className="absolute top-full right-0 left-0 z-20 mt-1 overflow-hidden rounded-md border border-admin-border bg-admin-surface shadow-lg">
              {suggestions.map((c, i) => {
                const active = i === highlight;
                return (
                  <button
                    key={c.id || `${c.name}-${c.email}-${i}`}
                    type="button"
                    // onMouseDown beats the input's onBlur, so the pick lands first.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(c);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    className={cn(
                      "block w-full border-b border-admin-border px-3 py-2 text-left text-sm last:border-b-0",
                      active ? "bg-russian-violet/10" : "hover:bg-admin-bg",
                    )}
                  >
                    <span className="font-medium text-admin-text">{c.name || c.email}</span>
                    {c.email && c.name && (
                      <span className="ml-2 text-sm text-admin-muted">{c.email}</span>
                    )}
                    {c.company && (
                      <span className="ml-2 text-sm text-admin-muted">{c.company}</span>
                    )}
                    {/* A phone-only contact shows its number, the only way to tell it's them. */}
                    {c.phone && (!c.email || sharedNames.has(c.name.trim().toLowerCase())) && (
                      <span className="ml-2 text-sm text-admin-muted">
                        {displayNZPhone(c.phone)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {renameOffer && (
          <label className="flex cursor-pointer items-start gap-2 text-sm text-admin-text-secondary 2xl:col-span-2 2xl:row-start-2">
            <input
              type="checkbox"
              checked={renameContact}
              onChange={(e) => onRenameContactChange(e.target.checked)}
              className={ADMIN_CHECKBOX_CLS}
            />
            <span>
              Also change the contact from {pickedContactName} to {renameOffer} when the invoice
              saves
            </span>
          </label>
        )}
        <div className="2xl:col-start-2 2xl:row-start-1">
          <EmailInput
            id="calculator-client-email"
            placeholder="Email"
            value={clientEmail}
            onChange={onClientEmailChange}
            className={ADMIN_INPUT_CLS}
          />
        </div>
        {/* Either email or mobile will do; a mobile-only client gets the quote by text. */}
        <PhoneInput
          id="calculator-client-phone"
          placeholder="Mobile"
          value={clientPhone}
          onChange={onClientPhoneChange}
          className={ADMIN_INPUT_CLS}
        />
      </div>
      {goldCardPercent != null && (
        <AdminCheckbox
          checked={goldCard}
          onChange={onGoldCardChange}
          label={`Gold Card (${goldCardOffText(goldCardPercent)})`}
        />
      )}
    </Card>
  );
}
