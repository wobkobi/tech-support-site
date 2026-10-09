"use client";
// src/features/business/components/calculator/ClientPickerSection.tsx
// Right-rail "Client" card. Typing the name inline-searches saved contacts via
// filterContacts; picking one fills name + email. A Name/Company/Custom segmented control
// appears after a pick, and typing over the picked name (adding a last name, say) switches
// it to Custom and offers to rename the contact too. "Clear" resets so the operator can
// search again.

import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { Card, CardHeader } from "@/features/admin/components/ui/Card";
import { adminChipClass } from "@/features/admin/components/ui/chip-classes";
import { ADMIN_CHECKBOX_CLS, ADMIN_INPUT_CLS } from "@/features/admin/components/ui/field-classes";
import { TEXT_ACTION_CLS } from "@/features/business/components/calculator/calculator-classes";
import type { GoogleContact } from "@/features/business/types/business";
import { filterContacts } from "@/features/contacts/lib/contact-search";
import { EmailInput } from "@/shared/components/EmailInput";
import { cn } from "@/shared/lib/cn";
import type React from "react";
import { useMemo, useRef, useState } from "react";

type AddressMode = "name" | "company" | "custom";

interface Props {
  clientName: string;
  onClientNameChange: (value: string) => void;
  clientEmail: string;
  onClientEmailChange: (value: string) => void;
  pickedContactName: string | null;
  pickedContactCompany: string | null;
  addressMode: AddressMode;
  onAddressModeChange: (mode: AddressMode) => void;
  /** The edited name a picked contact could be renamed to, or null when there is none. */
  renameOffer: string | null;
  renameContact: boolean;
  onRenameContactChange: (value: boolean) => void;
  contacts: GoogleContact[];
  onSelectContact: (contact: GoogleContact) => void;
  onClearContact: () => void;
}

const MAX_SUGGESTIONS = 6;

/**
 * Right-rail "Client" card. Type into Name to inline-search saved contacts -
 * a dropdown of matches surfaces below; click one to fill name + email. The
 * Name/Company/Custom segmented control appears after a pick, and editing the
 * filled name switches it to Custom so the edit sticks. "x Clear" resets so
 * the operator can search again or stay typing a custom name.
 * @param props - Component props.
 * @param props.clientName - Current Name value.
 * @param props.onClientNameChange - Name setter; fires on every keystroke.
 * @param props.clientEmail - Current Email value.
 * @param props.onClientEmailChange - Email setter.
 * @param props.pickedContactName - Picked contact's name, or null.
 * @param props.pickedContactCompany - Picked contact's company (drives Company availability).
 * @param props.addressMode - Current segmented-control selection.
 * @param props.onAddressModeChange - Flips the segmented control + updates clientName.
 * @param props.renameOffer - Edited name the picked contact could take, or null.
 * @param props.renameContact - Whether saving the invoice renames the contact.
 * @param props.onRenameContactChange - Ticks or unticks the rename.
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
  pickedContactName,
  pickedContactCompany,
  addressMode,
  onAddressModeChange,
  renameOffer,
  renameContact,
  onRenameContactChange,
  contacts,
  onSelectContact,
  onClearContact,
}: Props): React.ReactElement {
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inline autocomplete only fires before a pick, so editing a picked contact's name
  // doesn't keep nagging with suggestions.
  const searching = pickedContactName === null;

  const suggestions = useMemo(() => {
    if (!searching || !focused || !clientName.trim()) return [];
    return filterContacts(contacts, clientName).slice(0, MAX_SUGGESTIONS);
  }, [searching, focused, clientName, contacts]);

  /**
   * Commits a suggestion. Cancels the pending blur-close so the click lands
   * on the parent handler instead of being swallowed by the dropdown hiding.
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
      <CardHeader
        title="Client"
        className="mb-0 items-center"
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
                className={adminChipClass(active)}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      <div className="relative">
        <AdminInput
          type="text"
          placeholder="Name"
          value={clientName}
          onChange={(e) => {
            // A hand edit no longer matches the contact's name or company, so mark it
            // Custom; picking Name again puts the contact's own name back.
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
                  // onMouseDown beats the input's onBlur, so the pick lands
                  // before the dropdown is hidden by the deferred close.
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
                  {c.company && <span className="ml-2 text-sm text-admin-muted">{c.company}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {renameOffer && (
        <label className="flex cursor-pointer items-start gap-2 text-sm text-admin-text-secondary">
          <input
            type="checkbox"
            checked={renameContact}
            onChange={(e) => onRenameContactChange(e.target.checked)}
            className={ADMIN_CHECKBOX_CLS}
          />
          <span>
            Also change the contact from {pickedContactName} to {renameOffer} when the invoice saves
          </span>
        </label>
      )}
      <EmailInput
        id="calculator-client-email"
        placeholder="Email"
        value={clientEmail}
        onChange={onClientEmailChange}
        className={ADMIN_INPUT_CLS}
      />
    </Card>
  );
}
