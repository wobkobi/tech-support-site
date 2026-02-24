// src/lib/useOnVisible.ts
/**
 * @file useOnVisible.ts
 * @description React hook that tracks whether a DOM element is visible in the
 * viewport (via IntersectionObserver) or has received focus, triggering a
 * one-time visibility flag used to defer expensive resource loading.
 */

import { useEffect, useState } from "react";

/**
 * Hook that returns true when the given element becomes visible in the viewport
 * or receives focus. It disconnects the observer after the first visible event.
 * @param ref - React ref pointing to the element to observe.
 * @param ref.current - The DOM element to observe (or null if not yet mounted).
 * @param options - Optional IntersectionObserver configuration.
 * @returns True once the element has entered the viewport or received focus.
 */
export default function useOnVisible<T extends Element | null = Element>(
  ref: { current: T | null },
  options?: IntersectionObserverInit,
): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // If IntersectionObserver is not available (older browsers / test env),
    // consider the element visible so the script can load when needed.
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
      // In case the environment throws, fallback to visible.
      setVisible(true);
    }

    /**
     * Sets the element as visible and disconnects the observer on focus.
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
