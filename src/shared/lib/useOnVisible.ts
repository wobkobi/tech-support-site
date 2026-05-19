// src/shared/lib/useOnVisible.ts
/**
 * @file useOnVisible.ts
 * @description Hook that latches true once an element first becomes visible or
 * focused, used to defer loading heavy third-party scripts.
 */

import { useEffect, useState } from "react";

/**
 * Latch `true` once the element first enters the viewport or receives focus,
 * then disconnect. Used to defer loading heavy third-party scripts.
 * @param ref - Ref to the element to observe.
 * @param ref.current - DOM element (or null while unmounted).
 * @param options - IntersectionObserver options.
 * @returns Whether the element has been visible at least once.
 */
export default function useOnVisible<T extends Element | null = Element>(
  ref: { current: T | null },
  options?: IntersectionObserverInit,
): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // No IntersectionObserver (old browsers, test env): fall back to "always visible"
    // so the script still loads rather than silently never firing.
    if (typeof IntersectionObserver === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(true);
      return;
    }

    const el = ref.current;
    if (!el) return;

    let observer: IntersectionObserver | undefined;

    try {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer?.disconnect();
            break;
          }
        }
      }, options);

      observer.observe(el);
    } catch {
      // Defensive fallback if the constructor throws in some exotic env.
      setVisible(true);
    }

    /**
     * Focus fallback: keyboard users may tab to the element before it scrolls in.
     */
    const onFocus = (): void => {
      setVisible(true);
      observer?.disconnect();
    };

    el.addEventListener("focus", onFocus, true);

    return () => {
      observer?.disconnect();
      el.removeEventListener("focus", onFocus, true);
    };
  }, [ref, options]);

  return visible;
}
