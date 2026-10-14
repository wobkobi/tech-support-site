"use client";
// src/features/mailing/components/blocks/LinkPicker.tsx
// Where a button or picture goes: one of the site's pages, the Google profile, or any
// other web address typed in.

import { AdminInput } from "@/features/admin/components/ui/AdminInput";
import { AdminSelect } from "@/features/admin/components/ui/AdminSelect";
import type { LinkTarget } from "@/features/mailing/lib/insertables";
import type React from "react";
import { useState } from "react";

const OTHER = "__other";

/**
 * Link chooser.
 * @param props - Component props.
 * @param props.id - Id for the select, so a label can point at it.
 * @param props.value - The current link, or "" for none.
 * @param props.onChange - Called with the new link.
 * @param props.targets - The site's pages to offer.
 * @param props.noneLabel - Label for "no link"; leave out when a link is required.
 * @param props.disabled - Locks the control.
 * @returns The chooser.
 */
export function LinkPicker({
  id,
  value,
  onChange,
  targets,
  noneLabel,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (url: string) => void;
  targets: LinkTarget[];
  noneLabel?: string;
  disabled?: boolean;
}): React.ReactElement {
  const [custom, setCustom] = useState(() => value !== "" && !targets.some((t) => t.url === value));
  return (
    <div className="flex flex-col gap-2">
      <AdminSelect
        id={id}
        value={custom ? OTHER : value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setCustom(true);
            onChange("https://");
          } else {
            setCustom(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">{noneLabel ?? "Choose where it goes"}</option>
        {targets.map((t) => (
          <option key={t.url} value={t.url}>
            {t.label}
          </option>
        ))}
        <option value={OTHER}>Another web address</option>
      </AdminSelect>
      {custom && (
        <AdminInput
          type="url"
          inputMode="url"
          aria-label="Web address"
          placeholder="https://"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.trim())}
        />
      )}
    </div>
  );
}
