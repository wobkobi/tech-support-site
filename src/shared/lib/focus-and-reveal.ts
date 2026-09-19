// src/shared/lib/focus-and-reveal.ts
// Moves focus to something a form wants read (an error summary, a prompt) and centres it
// on screen, honouring reduced motion. Client-only: touches window and the DOM.

/**
 * Scroll behaviour that honours reduced motion.
 * @returns "auto" (jump) under reduced motion, otherwise "smooth".
 */
export function scrollBehaviour(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/**
 * Focuses an element and brings it to the middle of the viewport. Focus goes
 * first with preventScroll, because the browser's own focus-scroll jumps and
 * can leave the element under the fixed nav or a sticky submit band.
 * @param el - Element to focus.
 */
export function focusAndReveal(el: HTMLElement): void {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ behavior: scrollBehaviour(), block: "center" });
}
