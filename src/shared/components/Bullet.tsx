// src/shared/components/Bullet.tsx

import type React from "react";

/**
 * The site's list marker, placed ahead of the text in a `flex` list item. It
 * inherits the item's font size and line height, so the dot sits on the first
 * line at every breakpoint however far the text wraps. The scale enlarges the
 * glyph without growing its line box (self-start keeps that box one line tall,
 * so the scale centres on the first line). Hidden from screen readers, which
 * already announce each list item.
 * @returns The marker span.
 */
export function Bullet(): React.ReactElement {
  return (
    <span aria-hidden="true" className="shrink-0 scale-150 self-start text-moonstone-400">
      •
    </span>
  );
}
