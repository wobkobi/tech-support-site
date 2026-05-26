"use client";

import type React from "react";
import { cn } from "@/shared/lib/cn";

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
  onPickContact: () => void;
}

/**
 * Right-rail "Client" card. Pick-from-contacts plus a Name/Company/Custom
 * segmented control; Name is read-only outside Custom to lock the picked value.
 * @param props - Component props.
 * @param props.clientName - Current Name value.
 * @param props.onClientNameChange - Name setter (fires only when addressMode is "custom").
 * @param props.clientEmail - Current Email value.
 * @param props.onClientEmailChange - Email setter.
 * @param props.pickedContactName - Picked contact's name, or null.
 * @param props.pickedContactCompany - Picked contact's company (drives Company availability).
 * @param props.addressMode - Current segmented-control selection.
 * @param props.onAddressModeChange - Flips the segmented control + updates clientName.
 * @param props.onPickContact - Opens the contact picker modal.
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
  onPickContact,
}: Props): React.ReactElement {
  return (
    <div className={cn("space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
      <div className={cn("flex items-center justify-between")}>
        <h2 className={cn("text-russian-violet text-sm font-semibold")}>Client</h2>
        <button
          onClick={onPickContact}
          className={cn("hover:text-russian-violet text-xs text-slate-500 underline")}
        >
          Pick from contacts
        </button>
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
      <input
        type="text"
        placeholder="Name"
        value={clientName}
        readOnly={addressMode !== "custom"}
        onChange={(e) => onClientNameChange(e.target.value)}
        className={cn(
          "focus:ring-russian-violet/30 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2",
          addressMode !== "custom" && "bg-slate-50 text-slate-700",
        )}
      />
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
