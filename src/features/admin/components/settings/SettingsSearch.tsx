"use client";
// src/features/admin/components/settings/SettingsSearch.tsx
/**
 * @description Filter box that searches every setting's title + description
 * (and its group title) across all tabs. Selecting a result asks the parent to
 * jump to that field's tab and focus it. The index is built once from the
 * shared field metadata, so search and the editors never drift apart.
 */

import { FIELD_META_BY_GROUP, GROUP_META } from "@/shared/lib/settings/field-meta";
import type { SettingsGroup } from "@/shared/lib/settings/types";
import type React from "react";
import { useMemo, useState } from "react";

/** One searchable field entry. */
interface SearchItem {
  group: SettingsGroup;
  fieldKey: string;
  fieldTitle: string;
  description: string;
  groupTitle: string;
}

interface Props {
  /** Jump to a field: switch to its tab and focus it. */
  onJump: (group: SettingsGroup, fieldKey: string) => void;
}

/** Flat index of every field, built once at module load. */
const INDEX: SearchItem[] = (Object.keys(FIELD_META_BY_GROUP) as SettingsGroup[]).flatMap((group) =>
  Object.entries(FIELD_META_BY_GROUP[group]).map(([fieldKey, meta]) => ({
    group,
    fieldKey,
    fieldTitle: meta.title,
    description: meta.description,
    groupTitle: GROUP_META[group].title,
  })),
);

/**
 * Settings search box with a results dropdown.
 * @param props - Component props.
 * @param props.onJump - Called with the chosen field's group + key.
 * @returns Search element.
 */
export function SettingsSearch({ onJump }: Props): React.ReactElement {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return INDEX.filter(
      (it) =>
        it.fieldTitle.toLowerCase().includes(q) ||
        it.description.toLowerCase().includes(q) ||
        it.groupTitle.toLowerCase().includes(q),
    ).slice(0, 8);
  }, [query]);

  return (
    <div className="relative mb-4">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search settings (e.g. cancellation, GST, reminder)..."
        className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-base focus:ring-2 focus:ring-russian-violet/30 focus:outline-none"
      />
      {results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((it) => (
            <li key={`${it.group}.${it.fieldKey}`}>
              <button
                type="button"
                onClick={() => {
                  onJump(it.group, it.fieldKey);
                  setQuery("");
                }}
                className="block w-full px-4 py-2.5 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
              >
                <span className="text-sm font-medium text-slate-700">{it.fieldTitle}</span>
                <span className="text-xs text-slate-400"> - {it.groupTitle}</span>
                <p className="truncate text-xs text-slate-500">{it.description}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
