/**
 * @file tests/lib/useOnVisible.test.ts
 * @description Unit tests for useOnVisible hook edge cases
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { useRef } from "react";
import useOnVisible from "@/lib/useOnVisible";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("useOnVisible hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false initially when element is not visible", () => {
    global.IntersectionObserver = vi.fn(function () {
      return {
        observe: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn((): IntersectionObserverEntry[] => []),
      };
    }) as unknown as typeof IntersectionObserver;

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      // Attach ref to actual DOM element so hook can observe it
      if (!ref.current) {
        (ref as { current: HTMLDivElement | null }).current = document.createElement("div");
      }
      const visible = useOnVisible(ref);
      return { ref, visible };
    });

    expect(result.current.visible).toBe(false);
  });

  it("returns true when element becomes visible", async () => {
    let observerCallback: IntersectionObserverCallback | null = null;

    global.IntersectionObserver = vi.fn(function (callback: IntersectionObserverCallback) {
      observerCallback = callback;
      return {
        observe: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn((): IntersectionObserverEntry[] => []),
      };
    }) as unknown as typeof IntersectionObserver;

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      if (!ref.current) {
        (ref as { current: HTMLDivElement | null }).current = document.createElement("div");
      }
      const visible = useOnVisible(ref);
      return { ref, visible };
    });

    expect(result.current.visible).toBe(false);

    // Simulate intersection - wrap in act() for React state update tracking
    if (observerCallback) {
      await act(async () => {
        observerCallback!(
          [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
    }

    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });
  });

  it("returns true immediately when IntersectionObserver unavailable", async () => {
    // Simulate old browser without IntersectionObserver
    const originalIO = global.IntersectionObserver;
    Reflect.deleteProperty(global, "IntersectionObserver");

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      if (!ref.current) {
        (ref as { current: HTMLDivElement | null }).current = document.createElement("div");
      }
      const visible = useOnVisible(ref);
      return { ref, visible };
    });

    // When IntersectionObserver is unavailable, hook should set visible=true immediately
    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });

    // Restore
    global.IntersectionObserver = originalIO;
  });

  it("handles focus event and sets visible to true", async () => {
    global.IntersectionObserver = vi.fn(function () {
      return {
        observe: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn((): IntersectionObserverEntry[] => []),
      };
    }) as unknown as typeof IntersectionObserver;

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      if (!ref.current) {
        (ref as { current: HTMLDivElement | null }).current = document.createElement("div");
      }
      const visible = useOnVisible(ref);
      return { ref, visible };
    });

    expect(result.current.visible).toBe(false);

    // Simulate focus event on the element - wrap in act()
    if (result.current.ref.current) {
      await act(async () => {
        const focusEvent = new FocusEvent("focus", { bubbles: true });
        result.current.ref.current!.dispatchEvent(focusEvent);
      });
    }

    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });
  });

  it("disconnects observer after visibility or focus", async () => {
    const mockDisconnect = vi.fn();
    let observerCallback: IntersectionObserverCallback | null = null;

    global.IntersectionObserver = vi.fn(function (callback: IntersectionObserverCallback) {
      observerCallback = callback;
      return {
        observe: vi.fn(),
        disconnect: mockDisconnect,
        takeRecords: vi.fn((): IntersectionObserverEntry[] => []),
      };
    }) as unknown as typeof IntersectionObserver;

    const { result, unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      if (!ref.current) {
        (ref as { current: HTMLDivElement | null }).current = document.createElement("div");
      }
      const visible = useOnVisible(ref);
      return { ref, visible };
    });

    // Trigger visibility - wrap in act()
    if (observerCallback) {
      await act(async () => {
        observerCallback!(
          [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
    }

    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });

    // Verify disconnect was called
    expect(mockDisconnect).toHaveBeenCalled();

    unmount();
  });

  it("cleans up listeners on unmount", () => {
    const mockDisconnect = vi.fn();

    global.IntersectionObserver = vi.fn(function () {
      return {
        observe: vi.fn(),
        disconnect: mockDisconnect,
        takeRecords: vi.fn((): IntersectionObserverEntry[] => []),
      };
    }) as unknown as typeof IntersectionObserver;

    const { unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      // Create a real div element so hook can attach listener
      if (!ref.current) {
        (ref as { current: HTMLDivElement | null }).current = document.createElement("div");
      }
      const visible = useOnVisible(ref);
      return { ref, visible };
    });

    unmount();

    // Verify disconnect is called on unmount
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("handles IntersectionObserver constructor error gracefully", async () => {
    global.IntersectionObserver = vi.fn(() => {
      throw new Error("IntersectionObserver error");
    }) as unknown as typeof IntersectionObserver;

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      if (!ref.current) {
        (ref as { current: HTMLDivElement | null }).current = document.createElement("div");
      }
      const visible = useOnVisible(ref);
      return { ref, visible };
    });

    // Should fallback to visible=true on error - wait for effect to run
    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });
  });

  it("ignores non-intersecting entries", async () => {
    let observerCallback: IntersectionObserverCallback | null = null;

    global.IntersectionObserver = vi.fn(function (callback: IntersectionObserverCallback) {
      observerCallback = callback;
      return {
        observe: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn((): IntersectionObserverEntry[] => []),
      };
    }) as unknown as typeof IntersectionObserver;

    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(null);
      if (!ref.current) {
        (ref as { current: HTMLDivElement | null }).current = document.createElement("div");
      }
      const visible = useOnVisible(ref);
      return { ref, visible };
    });

    expect(result.current.visible).toBe(false);

    // Send non-intersecting entry - wrap in act()
    if (observerCallback) {
      await act(async () => {
        observerCallback!(
          [{ isIntersecting: false } as unknown as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
    }

    // Should still be false since entry is not intersecting
    expect(result.current.visible).toBe(false);
  });
});
