// src/features/social-design/components/use-doc-history.ts
// Design state with undo and redo. Edits run against a ref so quick edits never read a stale
// copy; edits sharing a tag within 1.5s merge into one undo step.

import type { DesignDoc } from "@/features/social-design/lib/doc";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

const MAX_STEPS = 100;
const MERGE_MS = 1500;

/** What the history hook hands the editor. */
export interface DocHistory {
  doc: DesignDoc;
  /** Runs an edit as one undo step (or merges it into the last step with the same tag). */
  apply: (edit: (doc: DesignDoc) => DesignDoc, tag?: string) => void;
  /** Runs an edit that isn't an undo step, like re-measuring text. */
  replace: (edit: (doc: DesignDoc) => DesignDoc) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** The latest design, for handlers that run between renders. */
  current: () => DesignDoc;
}

interface Stacks {
  doc: DesignDoc;
  past: DesignDoc[];
  future: DesignDoc[];
  tag: string | null;
  at: number;
}

/**
 * Design state with undo and redo.
 * @param initial - Design as loaded.
 * @param normalise - Runs after every edit, undo and redo; must return the same object when unchanged.
 * @returns History controls.
 */
export function useDocHistory(
  initial: DesignDoc,
  normalise: (doc: DesignDoc) => DesignDoc,
): DocHistory {
  // The ref is what edits read, so two edits in one tick each see the other's result;
  // the state copy is what renders.
  const [shown, setShown] = useState<Stacks>(() => ({
    doc: initial,
    past: [],
    future: [],
    tag: null,
    at: 0,
  }));
  const stacks = useRef<Stacks>(shown);
  const norm = useRef(normalise);
  useLayoutEffect(() => {
    norm.current = normalise;
  });

  /**
   * Stores new stacks and re-renders.
   * @param next - New stacks.
   */
  const commit = useCallback((next: Stacks) => {
    stacks.current = next;
    setShown(next);
  }, []);

  const apply = useCallback(
    (edit: (doc: DesignDoc) => DesignDoc, tag?: string) => {
      const s = stacks.current;
      const doc = norm.current(edit(s.doc));
      if (doc === s.doc) return;
      const now = Date.now();
      const merge = tag !== undefined && tag === s.tag && now - s.at < MERGE_MS;
      commit({
        doc,
        past: merge ? s.past : [...s.past, s.doc].slice(-MAX_STEPS),
        future: [],
        tag: tag ?? null,
        at: now,
      });
    },
    [commit],
  );

  const replace = useCallback(
    (edit: (doc: DesignDoc) => DesignDoc) => {
      const s = stacks.current;
      const doc = edit(s.doc);
      if (doc !== s.doc) commit({ ...s, doc });
    },
    [commit],
  );

  const undo = useCallback(() => {
    const s = stacks.current;
    const prev = s.past.at(-1);
    if (!prev) return;
    commit({
      doc: norm.current(prev),
      past: s.past.slice(0, -1),
      future: [s.doc, ...s.future],
      tag: null,
      at: 0,
    });
  }, [commit]);

  const redo = useCallback(() => {
    const s = stacks.current;
    const next = s.future[0];
    if (!next) return;
    commit({
      doc: norm.current(next),
      past: [...s.past, s.doc],
      future: s.future.slice(1),
      tag: null,
      at: 0,
    });
  }, [commit]);

  const current = useCallback(() => stacks.current.doc, []);

  return {
    doc: shown.doc,
    apply,
    replace,
    undo,
    redo,
    canUndo: shown.past.length > 0,
    canRedo: shown.future.length > 0,
    current,
  };
}
