"use client";
// src/features/business/components/calculator/NotesSection.tsx
// The calculator's Notes card. The text prints on the invoice preview and the saved invoice.

import { AdminField } from "@/features/admin/components/ui/AdminField";
import { AdminTextarea } from "@/features/admin/components/ui/AdminTextarea";
import { Card } from "@/features/admin/components/ui/Card";
import type React from "react";

interface Props {
  notes: string;
  onNotesChange: (notes: string) => void;
}

/**
 * Notes card on the calculator.
 * @param props - Component props.
 * @param props.notes - Current notes text.
 * @param props.onNotesChange - Called with the new notes text.
 * @returns Notes card element.
 */
export function NotesSection({ notes, onNotesChange }: Props): React.ReactElement {
  return (
    <Card>
      <AdminField label="Notes" htmlFor="calculator-notes">
        <AdminTextarea
          id="calculator-notes"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={2}
        />
      </AdminField>
    </Card>
  );
}
