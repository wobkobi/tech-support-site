// src/features/admin/lib/spread-evenly.ts
// Picks a few items spread across a list, for suggested times that cover the whole day.

/**
 * Picks up to `n` items evenly spread across `items`, including the first and last.
 * @param items - Candidate items in chronological order.
 * @param n - Maximum items to pick.
 * @returns Up to `n` evenly-spaced items.
 */
export function spreadEvenly<T>(items: T[], n: number): T[] {
  if (n <= 1) return items.slice(0, Math.max(0, n));
  if (items.length <= n) return items;
  const picks: T[] = [];
  for (let i = 0; i < n; i++) {
    picks.push(items[Math.round((i * (items.length - 1)) / (n - 1))]!);
  }
  return picks;
}
