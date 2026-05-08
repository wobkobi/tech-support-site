"use client";

import { useState } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";

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
 * @param root0 - Props
 * @param root0.token - Admin token
 * @returns Import widget element.
 */
export function SheetImportButton({ token }: { token: string }): React.ReactElement {
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
        headers: { "x-admin-secret": token },
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
        headers: { "x-admin-secret": token },
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
    <div className={cn("mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm")}>
      <h2 className={cn("mb-3 font-semibold text-slate-700")}>Import from Google Sheets</h2>

      {error && <p className={cn("mb-3 text-sm text-red-600")}>{error}</p>}

      {done && (
        <div
          className={cn(
            "mb-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800",
          )}
        >
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
            <ul className={cn("mt-2 list-inside list-disc text-xs text-green-900/80")}>
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
        <div
          className={cn(
            "mb-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700",
          )}
        >
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
            <ul className={cn("mt-2 list-inside list-disc text-xs text-slate-600")}>
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

      <div className={cn("flex gap-2")}>
        {!preview && !done && (
          <button
            onClick={() => {
              void handlePreview();
            }}
            disabled={loading}
            className={cn(
              "rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50",
            )}
          >
            {loading ? "Checking..." : "Preview import"}
          </button>
        )}
        {preview && !done && (
          <>
            <button
              onClick={() => {
                void handleImport();
              }}
              disabled={loading}
              className={cn(
                "bg-russian-violet rounded-lg px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50",
              )}
            >
              {loading ? "Importing..." : "Confirm import"}
            </button>
            <button
              onClick={() => setPreview(null)}
              disabled={loading}
              className={cn(
                "rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50",
              )}
            >
              Cancel
            </button>
          </>
        )}
        {done && (
          <button
            onClick={() => {
              setDone(null);
              setPreview(null);
            }}
            className={cn(
              "rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50",
            )}
          >
            Import again
          </button>
        )}
      </div>
    </div>
  );
}
