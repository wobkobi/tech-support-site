"use client";

import type { GoogleContact } from "@/features/business/types/business";
import { filterContacts } from "@/features/contacts/lib/contact-search";
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
  contacts: GoogleContact[];
  onSelectContact: (contact: GoogleContact) => void;
  onClearContact: () => void;
}

const MAX_SUGGESTIONS = 6;

/**
 * Right-rail "Client" card. Type into Name to inline-search saved contacts -
 * a dropdown of matches surfaces below; click one to fill name + email and
 * lock the picked value. The Name/Company/Custom segmented control appears
 * after a pick (Name is read-only outside Custom mode). "x Clear" resets so
 * the operator can search again or stay typing a custom name.
 * @param props - Component props.
 * @param props.clientName - Current Name value.
 * @param props.onClientNameChange - Name setter; fires on every keystroke when editable.
 * @param props.clientEmail - Current Email value.
 * @param props.onClientEmailChange - Email setter.
 * @param props.pickedContactName - Picked contact's name, or null.
 * @param props.pickedContactCompany - Picked contact's company (drives Company availability).
 * @param props.addressMode - Current segmented-control selection.
 * @param props.onAddressModeChange - Flips the segmented control + updates clientName.
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
  contacts,
  onSelectContact,
  onClearContact,
}: Props): React.ReactElement {
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Name is editable when no contact is picked, OR the segmented control is in
  // Custom mode. Inline autocomplete only fires on the "no pick" path so a
  // deliberate Custom override doesn't keep nagging with suggestions.
  const editable = pickedContactName === null;

  const suggestions = useMemo(() => {
    if (!editable || !focused || !clientName.trim()) return [];
    return filterContacts(contacts, clientName).slice(0, MAX_SUGGESTIONS);
  }, [editable, focused, clientName, contacts]);

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
    <div className={cn("space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
      <div className={cn("flex items-center justify-between")}>
        <h2 className={cn("text-russian-violet text-sm font-semibold")}>Client</h2>
        {pickedContactName && (
          <button
            type="button"
            onClick={onClearContact}
            className={cn("hover:text-russian-violet text-xs text-slate-500 underline")}
          >
            x Clear
          </button>
        )}
      </div>
      {pickedContactName && (
        <div className={cn("flex flex-wrap items-center gap-2")}>
          <span className={cn("text-xs font-medium text-slate-600")}>Address to:</span>
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
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-russian-violet/40 bg-russian-violet/10 text-russian-violet"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                  disabled && "cursor-not-allowed opacity-40 hover:border-slate-200",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      <div className={cn("relative")}>
        <input
          type="text"
          placeholder="Name"
          value={clientName}
          readOnly={!editable && addressMode !== "custom"}
          onChange={(e) => {
            onClientNameChange(e.target.value);
            setHighlight(0);
          }}
          onFocus={() => setFocused(true)}
          // Close-on-blur deferred so a click on a suggestion still fires.
          onBlur={() => {
            blurTimerRef.current = setTimeout(() => setFocused(false), 150);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
            !editable && addressMode !== "custom" && "bg-slate-50 text-slate-700",
          )}
        />
        {suggestions.length > 0 && (
          <div
            className={cn(
              "absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg",
            )}
          >
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
                    "block w-full border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0",
                    active ? "bg-russian-violet/10" : "hover:bg-slate-50",
                  )}
                >
                  <span className={cn("text-rich-black font-medium")}>{c.name || c.email}</span>
                  {c.email && c.name && (
                    <span className={cn("text-rich-black/50 ml-2 text-xs")}>{c.email}</span>
                  )}
                  {c.company && (
                    <span className={cn("text-rich-black/40 ml-2 text-xs")}>{c.company}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <input
        type="email"
        placeholder="Email"
        value={clientEmail}
        onChange={(e) => onClientEmailChange(e.target.value)}
        className={cn(
          "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
        )}
      />
    </div>
  );
}
