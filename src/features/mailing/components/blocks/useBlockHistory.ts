"use client";
// src/features/mailing/components/blocks/useBlockHistory.ts
// Undo and redo for the block editor: a stack of whole block-list snapshots. Typing in one
// field coalesces into a single step, so Undo takes back a sentence rather than a letter.

import type { Block } from "@/features/mailing/lib/blocks";
import { useState } from "react";

/** Snapshots kept for undo; older ones drop off. */
const MAX_STEPS = 100;
/** Edits to the same field closer together than this become one undo step. */
const MERGE_MS = 1500;

interface History {
  past: Block[][];
  present: Block[];
  future: Block[][];
  /** Field the last edit touched, for coalescing typing; null after a structural change. */
  mergeKey: string | null;
  at: number;
}

/**
 * Block list state with undo and redo.
 * @param initial - Builds the starting blocks.
 * @returns The current blocks plus commit, undo, redo and reset. `undo` and `redo`
 *   return the blocks they moved to, or null when there was nothing to move to.
 */
export function useBlockHistory(initial: () => Block[]): {
  blocks: Block[];
  commit: (next: Block[], mergeKey?: string) => void;
  undo: () => Block[] | null;
  redo: () => Block[] | null;
  reset: (blocks: Block[]) => void;
  canUndo: boolean;
  canRedo: boolean;
} {
  const [h, setH] = useState<History>(() => ({
    past: [],
    present: initial(),
    future: [],
    mergeKey: null,
    at: 0,
  }));

  /**
   * Records a new state. Passing the same `mergeKey` as the last edit within
   * {@link MERGE_MS} folds it into that step.
   * @param next - The new blocks.
   * @param mergeKey - Field being typed in, like `${blockId}:text`.
   */
  function commit(next: Block[], mergeKey?: string): void {
    const now = Date.now();
    setH((prev) => {
      const merge = Boolean(mergeKey) && prev.mergeKey === mergeKey && now - prev.at < MERGE_MS;
      return {
        past: merge ? prev.past : [...prev.past, prev.present].slice(-MAX_STEPS),
        present: next,
        future: [],
        mergeKey: mergeKey ?? null,
        at: now,
      };
    });
  }

  /**
   * Steps back one snapshot.
   * @returns The restored blocks, or null when there is no history.
   */
  function undo(): Block[] | null {
    const target = h.past.at(-1);
    if (!target) return null;
    setH({
      past: h.past.slice(0, -1),
      present: target,
      future: [h.present, ...h.future],
      mergeKey: null,
      at: 0,
    });
    return target;
  }

  /**
   * Steps forward one snapshot.
   * @returns The restored blocks, or null when there is nothing to redo.
   */
  function redo(): Block[] | null {
    const target = h.future[0];
    if (!target) return null;
    setH({
      past: [...h.past, h.present],
      present: target,
      future: h.future.slice(1),
      mergeKey: null,
      at: 0,
    });
    return target;
  }

  /**
   * Replaces everything, clearing the history: used when the body changed from
   * outside the editor (a template switch, the plain text tab).
   * @param blocks - The new blocks.
   */
  function reset(blocks: Block[]): void {
    setH({ past: [], present: blocks, future: [], mergeKey: null, at: 0 });
  }

  return {
    blocks: h.present,
    commit,
    undo,
    redo,
    reset,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
  };
}
