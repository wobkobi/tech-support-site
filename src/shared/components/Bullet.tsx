// src/shared/components/Bullet.tsx

import type React from "react";

/**
 * The site's list marker for a `flex` list item. Inherits font size and line height so the
 * dot sits on the first line; self-start keeps the scaled glyph's box one line tall. Hidden
 * from screen readers.
 * @returns The marker span.
 */
export function Bullet(): React.ReactElement {
  return (
    <span aria-hidden="true" className="shrink-0 scale-150 self-start text-moonstone-400">
      •
    </span>
  );
}
