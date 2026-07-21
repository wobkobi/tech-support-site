"use client";
// src/features/business/components/SheetImportButton.tsx
/**
 * @description Previews then imports Cashbook (income) and Expenses rows from
 * Google Sheets. The preview is a dry run; the import POSTs and writes to the
 * database. Shows per-sheet counts and errors.
 */

import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { Card } from "@/features/admin/components/ui/Card";
import type React from "react";
import { useState } from "react";

interface PerSheetCounts {
  fileId: string;
  name: string;
  incomeImported: number;
  incomeSkipped: number;
  expensesImported: number;
  expensesSkipped: number;
  errors: string[];
}

interface ImportResult {
  ok: boolean;
  incomeImported: number;
  incomeSkipped: number;
  expensesImported: number;
  expensesSkipped: number;
  errors: string[];
  perSheet?: PerSheetCounts[];
  source?: "folder" | "single";
}

/**
 * Button that previews then imports Cashbook and Expenses rows from Google Sheets.
 * @returns Import widget element.
 */
export function SheetImportButton(): React.ReactElement {
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Fetches a dry-run preview from the import API without writing to the database. */
  async function handlePreview(): Promise<void> {
    setLoading(true);
    setPreview(null);
    setDone(null);
    setError(null);
    try {
      const res = await fetch("/api/business/sheets/import", {
        headers: {},
      });
      if (!res.ok) throw new Error("Sheet read failed");
      const data = (await res.json()) as ImportResult;
      setPreview(data);
    } catch {
      setError("Could not read sheet. Check GOOGLE_SHEET_ID and OAuth.");
    } finally {
      setLoading(false);
    }
  }

  /** Sends a POST to the import API to write rows into the database. */
  async function handleImport(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/business/sheets/import", {
        method: "POST",
        headers: {},
      });
      if (!res.ok) throw new Error("Import failed");
      const data = (await res.json()) as ImportResult;
      setDone(data);
      setPreview(null);
    } catch {
      setError("Import failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mt-6">
      <h2 className="mb-3 font-semibold text-admin-text">Import from Google Sheets</h2>

      {error && <p className="mb-3 text-sm text-coquelicot-500">{error}</p>}

      {done && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <p className="font-medium">
            Import complete
            {done.source === "folder" && done.perSheet && ` - ${done.perSheet.length} sheet(s)`}
          </p>
          <p>
            Income: {done.incomeImported} imported, {done.incomeSkipped} skipped
          </p>
          <p>
            Expenses: {done.expensesImported} imported, {done.expensesSkipped} skipped
          </p>
          {done.perSheet && done.perSheet.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-emerald-900/80">
              {done.perSheet.map((s) => (
                <li key={s.fileId}>
                  <span className="font-medium">{s.name}</span>: {s.incomeImported} income,{" "}
                  {s.expensesImported} expenses
                  {s.errors.length > 0 && ` (${s.errors.length} errors)`}
                </li>
              ))}
            </ul>
          )}
          {done.errors.length > 0 && (
            <p className="mt-1 text-amber-700">{done.errors.length} row errors - check console</p>
          )}
        </div>
      )}

      {preview && !done && (
        <div className="mb-3 rounded-lg border border-admin-border bg-admin-bg px-4 py-3 text-sm text-admin-text">
          <p className="mb-1 font-medium">
            Preview (no changes made yet)
            {preview.source === "folder" &&
              preview.perSheet &&
              ` - ${preview.perSheet.length} sheet(s) found`}
          </p>
          <p>
            Income: {preview.incomeImported} to import, {preview.incomeSkipped} already exist or
            invalid
          </p>
          <p>
            Expenses: {preview.expensesImported} to import, {preview.expensesSkipped} already exist
            or invalid
          </p>
          {preview.perSheet && preview.perSheet.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-admin-muted">
              {preview.perSheet.map((s) => (
                <li key={s.fileId}>
                  <span className="font-medium">{s.name}</span>: {s.incomeImported} income,{" "}
                  {s.expensesImported} expenses to import
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex gap-2">
        {!preview && !done && (
          <AdminButton
            variant="secondary"
            busy={loading}
            onClick={() => {
              void handlePreview();
            }}
          >
            Preview import
          </AdminButton>
        )}
        {preview && !done && (
          <>
            <AdminButton
              variant="primary"
              busy={loading}
              onClick={() => {
                void handleImport();
              }}
            >
              Confirm import
            </AdminButton>
            <AdminButton variant="secondary" disabled={loading} onClick={() => setPreview(null)}>
              Cancel
            </AdminButton>
          </>
        )}
        {done && (
          <AdminButton
            variant="secondary"
            onClick={() => {
              setDone(null);
              setPreview(null);
            }}
          >
            Import again
          </AdminButton>
        )}
      </div>
    </Card>
  );
}
