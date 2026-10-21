// src/features/admin/components/settings/SettingsWithPreview.tsx
// Fields beside a pinned live preview from 2xl, for the settings tabs that have one.

import { StickyRail } from "@/features/admin/components/ui/StickyRail";
import type React from "react";

/** Props for {@link SettingsWithPreview}. */
interface SettingsWithPreviewProps {
  /** The tab's field rows. */
  children: React.ReactNode;
  /** The live preview card. */
  preview: React.ReactNode;
}

/**
 * Puts a tab's fields and its live preview side by side from 2xl, the preview pinned in a
 * rail; below 2xl the preview follows the fields. Starts at 2xl because at xl the field
 * rows' label column narrows to ~14rem and descriptions run 5-6 lines. Render the tab's
 * SettingsFooter after this, not inside it: the save bar bleeds to the card edges with
 * negative margins and pins to the bottom, so it must span the whole card.
 * @param props - Component props.
 * @param props.children - The tab's field rows.
 * @param props.preview - The live preview card.
 * @returns The fields and preview layout.
 */
export function SettingsWithPreview({
  children,
  preview,
}: SettingsWithPreviewProps): React.ReactElement {
  return (
    <div className="2xl:grid 2xl:grid-cols-[minmax(0,1fr)_26rem] 2xl:items-start 2xl:gap-6">
      <div className="min-w-0">{children}</div>
      {/* The previews carry a top margin for the stacked layout; beside the fields it
          would drop the card below the first row. */}
      <StickyRail className="2xl:*:mt-0">{preview}</StickyRail>
    </div>
  );
}
