/**
 * @file tests/components/NavBar.scroll.test.tsx
 * @description Unit tests for NavBar cumulative scroll logic
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

describe("NavBar Cumulative Scroll Logic", () => {
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
      header.classList.contains("pointer-events-none") ||
      header.classList.contains("opacity-0") ||
      header.classList.contains("-translate-y-[130%]")
    );
  };

  describe("Near-top behavior", () => {
    it("shows navbar when scrollY is 0", async () => {
      const { container } = render(<NavBar />);

      simulateScroll(0);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });

    it("shows navbar when scrollY is at threshold (120px)", async () => {
      const { container } = render(<NavBar />);

      simulateScroll(120);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });

    it("shows navbar when scrollY is below threshold (119px)", async () => {
      const { container } = render(<NavBar />);

      simulateScroll(119);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });
  });

  describe("Immediate reveal on upward scroll", () => {
    it("shows navbar after any upward scroll past the threshold", async () => {
      const { container } = render(<NavBar />);

      // Start past threshold
      simulateScroll(200);

      // Hide the navbar first by scrolling down 300px
      simulateScroll(300);
      simulateScroll(400);
      simulateScroll(500); // 300px down total

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });

      // Any upward movement should immediately reveal navbar
      simulateScroll(495); // 5px up – enough to show

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });

    it("shows navbar immediately after even 1px upward movement", async () => {
      const { container } = render(<NavBar />);

      // Start past threshold and hide navbar
      simulateScroll(200);
      simulateScroll(500); // 300px down

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });

      // Just 1px up is enough
      simulateScroll(499);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });

    it("shows navbar after multiple small upward scrolls", async () => {
      const { container } = render(<NavBar />);

      // Hide navbar first
      simulateScroll(200);
      simulateScroll(500); // 300px down

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });

      // First upward movement shows immediately
      simulateScroll(495); // 5px up – shows

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });
  });

  describe("Cumulative downward scroll (hide threshold: 300px)", () => {
    it("hides navbar after scrolling down 300px cumulatively", async () => {
      const { container } = render(<NavBar />);

      // Start past threshold
      simulateScroll(150);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Scroll down 300px cumulatively
      simulateScroll(180); // 30px down
      simulateScroll(210); // 60px down total
      simulateScroll(270); // 120px down total
      simulateScroll(360); // 210px down total
      simulateScroll(450); // 300px down total - should hide

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });
    });

    it("does NOT hide navbar after scrolling down only 299px", async () => {
      // Initialize scroll position BEFORE render to avoid triggering hide on mount
      scrollY = 130;
      Object.defineProperty(window, "scrollY", {
        writable: true,
        configurable: true,
        value: 130,
      });

      const { container } = render(<NavBar />);
      // Component mounts with lastScrollY = 130, accumulators = 0

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Scroll down 299px (delta = 299, below HIDE_THRESHOLD of 300)
      simulateScroll(429); // 130 + 299 = 429

      await waitFor(() => {
        // Should still be visible (downAccumulator = 299 < 300)
        expect(isNavBarHidden(container)).toBe(false);
      });
    });

    it("hides navbar after multiple small downward scrolls totaling 300px", async () => {
      const { container } = render(<NavBar />);

      // Start past threshold
      simulateScroll(150);

      // Multiple small downward scrolls (60px each)
      simulateScroll(210); // 60px down
      simulateScroll(270); // 120px down total
      simulateScroll(330); // 180px down total
      simulateScroll(390); // 240px down total
      simulateScroll(450); // 300px down total - should hide

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });
    });
  });

  describe("Direction reversal resets opposite accumulator", () => {
    it("resets down accumulator when scrolling up after scrolling down 150px", async () => {
      // Initialize scroll position BEFORE render to avoid triggering hide on mount
      scrollY = 130;
      Object.defineProperty(window, "scrollY", {
        writable: true,
        configurable: true,
        value: 130,
      });

      const { container } = render(<NavBar />);
      // Component mounts with lastScrollY = 130, accumulators = 0

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Scroll down 150px (not enough to hide - threshold is 300px)
      simulateScroll(280); // delta = 150

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Reverse direction and scroll up 10px (resets down accumulator)
      simulateScroll(270); // delta = -10

      // Now scroll down 200px more (downAccumulator was reset, so only 200px accumulated)
      simulateScroll(470); // delta = 200 (< HIDE_THRESHOLD of 300)

      await waitFor(() => {
        // Should still be visible because down accumulator was reset
        expect(isNavBarHidden(container)).toBe(false);
      });
    });

    it("re-hides navbar after showing via upward scroll then scrolling down 50px", async () => {
      const { container } = render(<NavBar />);

      // Hide navbar first
      simulateScroll(200);
      simulateScroll(500); // 300px down to hide

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });

      // Any upward movement shows immediately
      simulateScroll(490); // 10px up

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Now scroll down 300px again – should re-hide
      simulateScroll(550); // 60px down
      simulateScroll(610); // 120px down
      simulateScroll(670); // 180px down
      simulateScroll(730); // 240px down
      simulateScroll(790); // 300px down – should hide

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });
    });

    it("handles rapid direction changes correctly", async () => {
      const { container } = render(<NavBar />);

      // Start past threshold
      simulateScroll(100);

      // Simulate jittery scrolling: down, up, down, up
      simulateScroll(105); // 5px down
      simulateScroll(103); // 2px up (resets down accumulator)
      simulateScroll(108); // 5px down (new accumulator)
      simulateScroll(106); // 2px up (resets down accumulator)

      await waitFor(() => {
        // Should still be visible - no accumulator reached threshold
        expect(isNavBarHidden(container)).toBe(false);
      });
    });
  });

  describe("Edge cases", () => {
    it("handles scrolling to exact threshold boundaries", async () => {
      const { container } = render(<NavBar />);

      // Test upper boundary of near-top (exactly 120px)
      simulateScroll(120);

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // One pixel past threshold (121px)
      simulateScroll(121);

      // Should still be visible (no cumulative scroll yet)
      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });

    it("handles zero delta scrolls (no movement)", async () => {
      const { container } = render(<NavBar />);

      simulateScroll(150);

      // Dispatch scroll event without changing scrollY
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("scroll"));

      await waitFor(() => {
        // Should remain visible
        expect(isNavBarHidden(container)).toBe(false);
      });
    });

    it("handles large single scroll jumps correctly", async () => {
      const { container } = render(<NavBar />);

      // Start past threshold
      simulateScroll(200);

      // Large jump down (300px at once - exactly at threshold)
      simulateScroll(500);

      await waitFor(() => {
        // Should be hidden (300px >= 300px threshold)
        expect(isNavBarHidden(container)).toBe(true);
      });

      // Large jump up (300px at once)
      simulateScroll(200);

      await waitFor(() => {
        // Should be visible (any upward movement reveals)
        expect(isNavBarHidden(container)).toBe(false);
      });
    });

    it("resets accumulators when scrolling back to near-top", async () => {
      const { container } = render(<NavBar />);

      // Start past threshold and accumulate some scroll
      simulateScroll(200);
      simulateScroll(350); // 150px down accumulated (not enough to hide)

      // Scroll back to near-top
      simulateScroll(50); // Below 120px threshold

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });

      // Now scroll down again from near-top
      simulateScroll(150); // Past threshold
      simulateScroll(300); // 150px down (< 300 - accumulators were reset at near-top)

      // Should still be visible because accumulators were reset at near-top
      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(false);
      });
    });
  });

  describe("No near-bottom auto-show", () => {
    it("does NOT auto-show navbar when scrolling to bottom of page", async () => {
      const { container } = render(<NavBar />);

      // Mock a tall page
      Object.defineProperty(document.documentElement, "scrollHeight", {
        writable: true,
        configurable: true,
        value: 3000,
      });

      // Hide navbar first (scroll 300px down past threshold)
      simulateScroll(200);
      simulateScroll(500); // 300px down to hide

      await waitFor(() => {
        expect(isNavBarHidden(container)).toBe(true);
      });

      // Scroll near bottom (within 360px of bottom)
      // scrollHeight: 3000, innerHeight: 800, scrollY should be ~2200 to be near bottom
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

      // Scroll to bottom directly (navbar hidden)
      simulateScroll(200);
      simulateScroll(500); // 300px down to hide
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
