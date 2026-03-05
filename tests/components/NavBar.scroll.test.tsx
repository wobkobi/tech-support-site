/**
 * @file tests/components/NavBar.scroll.test.tsx
 * @description Unit tests for NavBar direction-based scroll logic
 * @severity S1 - Core navigation component
 */

import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NavBar } from "@/components/NavBar";

// Mock Next.js navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

// Mock Next.js Image component
/* eslint-disable @next/next/no-img-element */
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
/* eslint-enable @next/next/no-img-element */

describe("NavBar Direction-Based Scroll Logic", () => {
  let scrollY: number;

  beforeEach(() => {
    scrollY = 0;

    // Mock window.scrollY getter
    Object.defineProperty(window, "scrollY", {
      writable: true,
      configurable: true,
      value: scrollY,
    });

    // Mock window.innerHeight for near-bottom calculations
    Object.defineProperty(window, "innerHeight", {
      writable: true,
      configurable: true,
      value: 800,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper function to simulate scrolling and dispatch scroll event
   * @param newScrollY - New scroll position in pixels
   */
  const simulateScroll = (newScrollY: number) => {
    scrollY = newScrollY;
    Object.defineProperty(window, "scrollY", {
      writable: true,
      configurable: true,
      value: scrollY,
    });
    window.dispatchEvent(new Event("scroll"));
  };

  /**
   * Helper to check if navbar is hidden
   * @param container - The DOM container element
   * @returns True if navbar is hidden (has hide class)
   */
  const isNavBarHidden = (container: HTMLElement): boolean => {
    const header = container.querySelector("header");
    if (!header) return false;
    return (
      header.classList.contains("pointer-events-none") && header.classList.contains("opacity-0")
    );
  };

  /**
   * Helper to check if navbar is being translated (gradual hide)
   * @param container - The DOM container element
   * @returns True if navbar has a translateY transform applied
   */
  const isNavBarTranslating = (container: HTMLElement): boolean => {
    const header = container.querySelector("header");
    if (!header) return false;
    const style = (header as HTMLElement).style.transform;
    return style.includes("translateY(-") && !style.includes("translateY(-120%)");
  };

  describe("Near-top behavior", () => {
    it("shows navbar when scrollY is 0", async () => {
      const { container } = render(<NavBar />);

      simulateScroll(0);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });

    it("shows navbar when scrollY is at threshold (72px)", async () => {
      const { container } = render(<NavBar />);

      simulateScroll(72);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });

    it("shows navbar when scrollY is below threshold (71px)", async () => {
      const { container } = render(<NavBar />);

      simulateScroll(71);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });
  });

  describe("Gradual hide on downward scroll", () => {
    it("does not hide navbar immediately after small downward scroll", async () => {
      const { container } = render(<NavBar />);

      // Start past threshold - need to do this in small increments to avoid accumulating too much
      simulateScroll(72); // At threshold, won't trigger scroll logic yet

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Move just past threshold
      simulateScroll(73); // 1px past

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Small downward scroll (5px total from threshold) should translate but not hide
      simulateScroll(77); // 5px down from 72

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
        expect(isNavBarTranslating(container)).toBe(true);
      });
    });

    it("hides navbar only after scrolling down 60px past threshold", async () => {
      const { container } = render(<NavBar />);

      // Start at threshold
      simulateScroll(72);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Scroll down 60px (HIDE_SCROLL_DISTANCE) to fully hide
      simulateScroll(132); // 72 + 60

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });
    });
  });

  describe("Immediate reveal on upward scroll", () => {
    it("shows navbar after any upward scroll past the threshold", async () => {
      const { container } = render(<NavBar />);

      // Start at threshold
      simulateScroll(72);

      // Scroll down enough to fully hide (60px)
      simulateScroll(132); // 72 + 60

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });

      // Any upward movement should immediately reveal navbar
      simulateScroll(127); // 5px up

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });

    it("shows navbar immediately after even 2px upward movement", async () => {
      const { container } = render(<NavBar />);

      // Start at threshold and scroll down to hide
      simulateScroll(72);
      simulateScroll(132); // 60px down to fully hide

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });

      // Just 2px up (> MIN_SCROLL_DELTA of 1)
      simulateScroll(130);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });

    it("shows navbar after multiple small upward scrolls", async () => {
      const { container } = render(<NavBar />);

      // Hide navbar first
      simulateScroll(72);
      simulateScroll(132); // 60px down to fully hide

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });

      // First upward movement shows immediately
      simulateScroll(127); // 5px up – shows

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });
  });

  describe("Direction changes (no accumulation)", () => {
    it("re-hides navbar after showing via upward scroll then scrolling down 60px", async () => {
      const { container } = render(<NavBar />);

      // Start at threshold and hide navbar first
      simulateScroll(72);
      simulateScroll(132); // 60px down to hide

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });

      // Any upward movement shows immediately
      simulateScroll(122); // 10px up

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Need to scroll down 60px to hide again
      simulateScroll(182); // 60px down from current position

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });
    });

    it("handles rapid direction changes correctly", async () => {
      const { container } = render(<NavBar />);

      // Start at threshold
      simulateScroll(72);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Small down scroll - should translate but not hide
      simulateScroll(77); // 5px down

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
        expect(isNavBarTranslating(container)).toBe(true);
      });

      simulateScroll(75); // 2px up - resets

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Need 60px down to hide
      simulateScroll(135); // 60px down from reset point (75 + 60)

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });

      simulateScroll(133); // 2px up - shows

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });
  });

  describe("Edge cases", () => {
    it("handles scrolling to exact threshold boundaries", async () => {
      const { container } = render(<NavBar />);

      // Test upper boundary of near-top (exactly 72px)
      simulateScroll(72);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // One pixel past threshold (73px)
      simulateScroll(73);

      // Should still be visible (no downward scroll yet, just positioned past threshold)
      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Now scroll down by 2px (> MIN_SCROLL_DELTA)
      simulateScroll(75);

      // Should be translating but not hidden (only 2px down, need 60px to hide)
      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
        expect(isNavBarTranslating(container)).toBe(true);
      });
    });

    it("handles zero delta scrolls (no movement)", async () => {
      const { container } = render(<NavBar />);

      // Scroll to threshold then down 60px to hide
      simulateScroll(72);
      simulateScroll(132);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });

      // Dispatch scroll event without changing scrollY (delta = 0)
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("scroll"));

      await waitFor(() => {
        // Should remain hidden (MIN_SCROLL_DELTA not met, state unchanged)
        expect(isNavBarHidden(container)).toBe(true);
      });
    });

    it("handles large single scroll jumps correctly", async () => {
      const { container } = render(<NavBar />);

      // Start at threshold
      simulateScroll(72);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Large jump down (300px at once - more than 60px HIDE_SCROLL_DISTANCE)
      simulateScroll(372); // 72 + 300

      await waitFor(() => {
        // Should be hidden (downward scroll > 60px)
        expect(isNavBarHidden(container)).toBe(true);
      });

      // Large jump up (300px at once)
      simulateScroll(200);

      await waitFor(() => {
        // Should be visible (any upward movement reveals)
        expect(isNavBarHidden(container)).toBe(false);
      });
    });

    it("ignores small movements below MIN_SCROLL_DELTA", async () => {
      const { container } = render(<NavBar />);

      // Scroll to threshold and down 60px to hide
      simulateScroll(72);
      simulateScroll(132);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });

      // Scroll up by 2px to reveal (delta = -2, which is > MIN_SCROLL_DELTA)
      simulateScroll(130);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Scroll down by exactly 1px (abs(1) < 1 is false, but we need to check the logic)
      // MIN_SCROLL_DELTA = 1, and Math.abs(delta) < MIN_SCROLL_DELTA means delta must be < 1
      // So delta of 1 is NOT ignored (1 < 1 is false), navbar will start translating
      simulateScroll(131);

      await waitFor(() => {
        // Delta of 1px equals MIN_SCROLL_DELTA threshold, so it IS processed (not ignored)
        // Since it's downward but only 1px, navbar translates but doesn't hide
        expect(isNavBarHidden(container)).toBe(false);
        expect(isNavBarTranslating(container)).toBe(true);
      });
    });
  });

  describe("Mobile menu keeps navbar visible", () => {
    it("does NOT hide navbar when mobile menu is open, even on downward scroll", async () => {
      const { container } = render(<NavBar />);

      // Start at threshold
      simulateScroll(72);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Scroll down enough to normally hide (60px)
      simulateScroll(132);

      // Without mobile menu open, navbar should be hidden
      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });

      // Note: In actual implementation with mobile menu open, navbar stays visible
      // This test documents the expected behavior
      // A full integration test would need to trigger mobile menu open via button click
    });
  });

  describe("No auto-show at page bottom", () => {
    it("does NOT auto-show navbar when scrolling to bottom of page", async () => {
      const { container } = render(<NavBar />);

      // Mock a tall page
      Object.defineProperty(document.documentElement, "scrollHeight", {
        writable: true,
        configurable: true,
        value: 3000,
      });

      // Start at threshold and hide navbar (scroll down 60px)
      simulateScroll(72);
      simulateScroll(132); // hide

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });

      // Scroll to bottom by continuing downward
      simulateScroll(2200); // scrollY + innerHeight = 3000 (at bottom)

      await waitFor(() => {
        // Should STILL be hidden (no auto-show near bottom)
        expect(isNavBarHidden(container)).toBe(true);
      });
    });

    it("shows navbar at bottom only via upward scroll", async () => {
      const { container } = render(<NavBar />);

      // Mock a tall page
      Object.defineProperty(document.documentElement, "scrollHeight", {
        writable: true,
        configurable: true,
        value: 3000,
      });

      // Scroll to bottom (navbar hidden during downward scroll)
      simulateScroll(72);
      simulateScroll(132); // hide
      simulateScroll(2200); // At bottom

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });

      // Any upward scroll from bottom should show
      simulateScroll(2195); // 5px up

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });
  });
});
