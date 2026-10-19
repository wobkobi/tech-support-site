// src/features/social-design/components/use-design-autosave.ts
// Saves the open design 1.2s after the last change. A 409 means another tab saved since,
// so saving stops until reload.

import type { DesignKind } from "@/features/social-design/lib/design-row";
import type { DesignDoc } from "@/features/social-design/lib/doc";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const AUTOSAVE_MS = 1200;

/** Where the latest change is. */
export type SaveState = "saved" | "unsaved" | "saving" | "error" | "conflict";

/** What gets saved. */
export interface DesignFields {
  name: string;
  kind: DesignKind;
  doc: DesignDoc;
}

/** Fields as last saved, with the document as JSON for a cheap compare. */
interface SavedFields {
  name: string;
  kind: DesignKind;
  docJson: string;
}

/**
 * Fields that changed since the last save.
 * @param now - Current fields.
 * @param saved - Fields as last saved.
 * @returns Changed fields only.
 */
function changedFields(now: DesignFields, saved: SavedFields): Partial<DesignFields> {
  const out: Partial<DesignFields> = {};
  if (now.name !== saved.name) out.name = now.name;
  if (now.kind !== saved.kind) out.kind = now.kind;
  if (JSON.stringify(now.doc) !== saved.docJson) out.doc = now.doc;
  return out;
}

/**
 * Autosave for one design.
 * @param id - Design id.
 * @param initialUpdatedAt - updatedAt as loaded.
 * @param fields - Current name, kind and document.
 * @param onError - Shows a failed save's message.
 * @returns Save state and a save-now function.
 */
export function useDesignAutosave(
  id: string,
  initialUpdatedAt: string,
  fields: DesignFields,
  onError: (message: string) => void,
): { state: SaveState; saveNow: () => Promise<boolean> } {
  const [state, setState] = useState<SaveState>("saved");
  const expected = useRef(initialUpdatedAt);
  const saved = useRef<SavedFields>({
    name: fields.name,
    kind: fields.kind,
    docJson: JSON.stringify(fields.doc),
  });
  const inFlight = useRef<Promise<boolean> | null>(null);
  const latest = useRef(fields);
  useLayoutEffect(() => {
    latest.current = fields;
  });
  const stopped = useRef(false);

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (stopped.current) return false;
    // Chain behind a save already running so two PATCHes never race.
    if (inFlight.current) await inFlight.current;
    const target = latest.current;
    const changed = changedFields(target, saved.current);
    if (Object.keys(changed).length === 0) {
      setState("saved");
      return true;
    }
    setState("saving");
    const run = (async (): Promise<boolean> => {
      try {
        const res = await fetch(`/api/admin/social/designs/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...changed, expectedUpdatedAt: expected.current }),
        });
        const data = (await res.json().catch(() => null)) as
          { ok: true; updatedAt: string } | { ok: false; error: string } | null;
        if (res.status === 409) {
          stopped.current = true;
          setState("conflict");
          return false;
        }
        if (!data?.ok) {
          setState("error");
          onError(data && !data.ok ? data.error : `Save failed (${res.status}).`);
          return false;
        }
        expected.current = data.updatedAt;
        saved.current = {
          name: target.name,
          kind: target.kind,
          docJson: JSON.stringify(target.doc),
        };
        return true;
      } catch {
        setState("error");
        onError("Couldn't reach the server. Your changes will save when it's back.");
        return false;
      }
    })();
    inFlight.current = run;
    const ok = await run;
    inFlight.current = null;
    // Something changed while saving: stay unsaved so the timer saves it next.
    if (ok) {
      const more = Object.keys(changedFields(latest.current, saved.current)).length > 0;
      setState(more ? "unsaved" : "saved");
    }
    return ok;
  }, [id, onError]);

  // Save a moment after editing stops.
  useEffect(() => {
    if (stopped.current) return;
    if (Object.keys(changedFields(fields, saved.current)).length === 0) return;
    setState((s) => (s === "saving" ? s : "unsaved"));
    const timer = setTimeout(() => void saveNow(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [fields, saveNow]);

  // Warn before leaving with a change not yet saved.
  useEffect(() => {
    if (state === "saved") return;
    /**
     * Asks the browser to confirm leaving the page.
     * @param e - The unload event.
     */
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state]);

  return { state, saveNow };
}
