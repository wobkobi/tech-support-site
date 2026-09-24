// Label/value row for the detail pages' fields rail (booking, invoice, contact).

import type React from "react";

/**
 * A label/value row inside a rail card.
 * @param props - Component props.
 * @param props.label - Row label.
 * @param props.children - Row value.
 * @returns Row element.
 */
export function InfoRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-admin-muted">{label}</dt>
      <dd className="text-right font-medium text-admin-text">{children}</dd>
    </div>
  );
}
