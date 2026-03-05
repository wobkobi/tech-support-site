/**
 * @file tests/components/NavBar.landscape.test.tsx
 * @description Integration tests for NavBar mobile menu scrolling in landscape orientation
 * @severity S2 - Navigation usability on mobile devices
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
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

describe("NavBar Mobile Menu - Landscape Orientation", () => {
  beforeAll(() => {
    // Mock window.scrollTo to suppress jsdom warning
    window.scrollTo = vi.fn();
  });

  beforeEach(() => {
    // Reset viewport mocks before each test
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Helper to set viewport dimensions
   * @param width - Viewport width in pixels
   * @param height - Viewport height in pixels
   */
  const setViewport = (width: number, height: number) => {
    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: width,
    });
    Object.defineProperty(window, "innerHeight", {
      writable: true,
      configurable: true,
      value: height,
    });
  };

  describe("Landscape viewport (short height)", () => {
    it("mobile menu does not exceed viewport height in iPhone SE landscape", () => {
      // iPhone SE landscape: 667x375
      setViewport(667, 375);

      render(<NavBar />);

      // Open mobile menu
      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      // Find the mobile menu nav element
      const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });

      // The menu should have max-height that accounts for:
      // - top position (top-27 = 6.75rem = 108px)
      // - safe area and padding (~1.25rem = 20px)
      // - total offset: ~8rem = 128px
      // So max-height should be approximately: 375px - 128px = 247px

      // Verify max-height class is present (jsdom doesn't compute Tailwind styles)
      expect(mobileNav.className).toMatch(/max-h-\[calc\(100dvh-8rem\)\]/);

      // Verify overflow-y-auto is present (allows scrolling)
      expect(mobileNav.classList.contains("overflow-y-auto")).toBe(true);
    });

    it("mobile menu has overscroll-behavior-contain to prevent scroll chaining", () => {
      setViewport(667, 375);

      render(<NavBar />);

      // Open mobile menu
      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      // Find the mobile menu nav element
      const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });

      // Verify overscroll-behavior-contain class is present
      // This prevents scroll chaining to the background page
      expect(mobileNav.className).toContain("overscroll-behavior");
    });

    it("all menu items are present and accessible in Pixel 7 landscape", () => {
      // Pixel 7 landscape: 915x412
      setViewport(915, 412);

      render(<NavBar />);

      // Open mobile menu
      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      // Scope queries to mobile menu to avoid ambiguity with desktop nav
      const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });

      // Verify all 5 navigation links are present
      expect(within(mobileNav).getByRole("link", { name: "Services" })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: "Pricing" })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: "About" })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: "FAQ" })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: "Reviews" })).toBeDefined();

      // Verify CTA buttons are present
      expect(within(mobileNav).getByRole("link", { name: "Book now" })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: "Contact" })).toBeDefined();
    });

    it("mobile menu uses dvh instead of vh for dynamic viewport height", () => {
      setViewport(667, 375);

      render(<NavBar />);

      // Open mobile menu
      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      // Find the mobile menu nav element
      const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });

      // Check that the className contains dvh-based max-height
      // The class should be something like: max-h-[calc(100dvh-8rem)]
      const classNames = mobileNav.className;

      // This test verifies that dvh is used (dynamic viewport height)
      // which handles iOS Safari's shrinking address bar correctly
      expect(classNames).toMatch(/max-h-\[calc\(100dvh/);
    });
  });

  describe("Portrait viewport (tall height) - no regression", () => {
    it("mobile menu works correctly in iPhone SE portrait", () => {
      // iPhone SE portrait: 375x667
      setViewport(375, 667);

      render(<NavBar />);

      // Open mobile menu
      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      // Scope queries to mobile menu to avoid ambiguity with desktop nav
      const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });

      // All items should be accessible
      expect(within(mobileNav).getByRole("link", { name: "Services" })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: "Book now" })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: "Contact" })).toBeDefined();
    });

    it("mobile menu works correctly in Pixel 7 portrait", () => {
      // Pixel 7 portrait: 412x915
      setViewport(412, 915);

      render(<NavBar />);

      // Open mobile menu
      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      // Scope queries to mobile menu to avoid ambiguity with desktop nav
      const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });

      // All items should be accessible
      expect(within(mobileNav).getByRole("link", { name: "Reviews" })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: "Book now" })).toBeDefined();
    });
  });

  describe("Menu positioning and layout", () => {
    it("mobile menu is positioned fixed with correct offset from top", () => {
      setViewport(667, 375);

      render(<NavBar />);

      // Open mobile menu
      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });

      // Verify fixed positioning
      expect(mobileNav.classList.contains("fixed")).toBe(true);

      // Verify top offset (top-27 or sm:top-30)
      expect(
        mobileNav.classList.contains("top-27") || mobileNav.classList.contains("sm:top-30"),
      ).toBe(true);
    });

    it("mobile menu max-height accounts for top offset to prevent clipping", () => {
      setViewport(667, 375);

      render(<NavBar />);

      // Open mobile menu
      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
      const classNames = mobileNav.className;

      // The max-height should account for the top offset
      // top-27 = 6.75rem (~108px), so max-height should subtract at least 7-8rem
      // to prevent the menu from extending beyond the viewport

      // Verify the calc includes appropriate offset (8rem in the fix)
      expect(classNames).toMatch(/max-h-\[calc\(100dvh-\d+rem\)\]/);
    });
  });

  describe("Scroll behavior", () => {
    it("mobile menu is scrollable when content exceeds viewport", async () => {
      // Set very short viewport to force scrolling
      setViewport(667, 300);

      render(<NavBar />);

      // Open mobile menu
      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });

      // Verify overflow-y-auto allows scrolling
      expect(mobileNav.classList.contains("overflow-y-auto")).toBe(true);

      // The menu should have scrollHeight > clientHeight if content overflows
      // (This would be tested in real browser, here we just verify the class)
    });

    it("mobile menu prevents scroll chaining to background", () => {
      setViewport(667, 375);

      render(<NavBar />);

      // Open mobile menu
      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });

      // Verify overscroll-behavior-contain is present
      // This CSS property prevents the scroll from "chaining" to the parent (body)
      // Important for iOS Safari and Android Chrome
      const classNames = mobileNav.className;
      expect(classNames).toContain("overscroll-behavior");
    });
  });

  describe("Accessibility", () => {
    it("mobile menu is labeled for screen readers", () => {
      setViewport(667, 375);

      render(<NavBar />);

      // Open mobile menu
      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      // Menu should have proper aria-label
      const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
      expect(mobileNav).toBeDefined();
    });

    it("hamburger button has correct aria-expanded state", () => {
      setViewport(667, 375);

      render(<NavBar />);

      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");

      // Initially closed
      expect(hamburgerButton.getAttribute("aria-expanded")).toBe("false");

      // After click, should be expanded
      fireEvent.click(hamburgerButton);
      expect(hamburgerButton.getAttribute("aria-expanded")).toBe("true");

      // After second click, should be closed
      fireEvent.click(hamburgerButton);
      expect(hamburgerButton.getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("Cross-device compatibility", () => {
    const landscapeDevices = [
      { name: "iPhone SE", width: 667, height: 375 },
      { name: "iPhone 12", width: 844, height: 390 },
      { name: "Pixel 7", width: 915, height: 412 },
      { name: "Galaxy S21", width: 800, height: 360 },
    ];

    landscapeDevices.forEach(({ name, width, height }) => {
      it(`menu is accessible on ${name} landscape (${width}x${height})`, () => {
        setViewport(width, height);

        render(<NavBar />);

        // Open mobile menu
        const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
        fireEvent.click(hamburgerButton);

        // Scope queries to mobile menu to avoid ambiguity with desktop nav
        const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });

        // Verify key menu items are present
        expect(within(mobileNav).getByRole("link", { name: "Services" })).toBeDefined();
        expect(within(mobileNav).getByRole("link", { name: "Book now" })).toBeDefined();
        expect(within(mobileNav).getByRole("link", { name: "Contact" })).toBeDefined();
      });
    });
  });

  describe("Edge cases and user interactions", () => {
    it("closes mobile menu when clicking overlay backdrop", () => {
      setViewport(667, 375);

      render(<NavBar />);

      // Open mobile menu
      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      // Verify menu is open
      expect(hamburgerButton.getAttribute("aria-expanded")).toBe("true");
      const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
      expect(mobileNav).toBeDefined();

      // Find and click the overlay backdrop
      // The overlay is rendered as a div with onClick handler
      const overlay = document.querySelector(".bg-rich-black\\/50");
      expect(overlay).toBeDefined();

      if (overlay) {
        fireEvent.click(overlay);
      }

      // Verify menu is closed
      expect(hamburgerButton.getAttribute("aria-expanded")).toBe("false");
    });

    it("locks body scroll when mobile menu opens in landscape", () => {
      setViewport(667, 375);

      render(<NavBar />);

      const body = document.body;

      // Initially, body should not have scroll lock styles
      expect(body.style.overflow).toBe("");
      expect(body.style.position).toBe("");

      // Open mobile menu
      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      // Body should have scroll lock styles applied
      // Note: useEffect runs asynchronously, so styles are applied after render
      waitFor(() => {
        expect(body.style.overflow).toBe("hidden");
        expect(body.style.position).toBe("fixed");
        expect(body.style.width).toBe("100%");
      });
    });

    it("restores body scroll when mobile menu closes in landscape", async () => {
      setViewport(667, 375);

      render(<NavBar />);

      const body = document.body;
      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");

      // Open menu
      fireEvent.click(hamburgerButton);

      await waitFor(() => {
        expect(body.style.overflow).toBe("hidden");
      });

      // Close menu
      fireEvent.click(hamburgerButton);

      // Body styles should be restored
      await waitFor(() => {
        expect(body.style.overflow).toBe("");
        expect(body.style.position).toBe("");
        expect(body.style.width).toBe("");
      });
    });

    it("handles rapid open/close toggling without state corruption", async () => {
      setViewport(667, 375);

      render(<NavBar />);

      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");

      // Rapidly toggle menu 5 times
      fireEvent.click(hamburgerButton); // Open
      fireEvent.click(hamburgerButton); // Close
      fireEvent.click(hamburgerButton); // Open
      fireEvent.click(hamburgerButton); // Close
      fireEvent.click(hamburgerButton); // Open

      // After 5 toggles, menu should be open (odd number of clicks)
      await waitFor(() => {
        expect(hamburgerButton.getAttribute("aria-expanded")).toBe("true");
      });

      // Menu should be accessible
      const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
      expect(mobileNav).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: "Services" })).toBeDefined();
    });

    it("handles viewport rotation from landscape to portrait while menu is open", () => {
      // Start in landscape
      setViewport(667, 375);

      render(<NavBar />);

      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      // Verify menu is open in landscape
      expect(hamburgerButton.getAttribute("aria-expanded")).toBe("true");
      let mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
      expect(mobileNav.className).toMatch(/max-h-\[calc\(100dvh-8rem\)\]/);

      // Rotate to portrait (swap dimensions)
      setViewport(375, 667);
      fireEvent(window, new Event("resize"));

      // Menu should still be open
      expect(hamburgerButton.getAttribute("aria-expanded")).toBe("true");

      // Menu should still have proper height constraint
      mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
      expect(mobileNav.className).toMatch(/max-h-\[calc\(100dvh-8rem\)\]/);

      // Menu items should still be accessible
      expect(within(mobileNav).getByRole("link", { name: "Services" })).toBeDefined();
    });

    it("remains usable in extreme short viewport (250px height)", () => {
      // Simulate iPhone SE landscape with keyboard open
      setViewport(667, 250);

      render(<NavBar />);

      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });

      // Should still have scroll capability
      expect(mobileNav.classList.contains("overflow-y-auto")).toBe(true);

      // Should have constrained height
      expect(mobileNav.className).toMatch(/max-h-\[calc\(100dvh-8rem\)\]/);

      // All links should be present in DOM (scrollable into view)
      expect(within(mobileNav).getByRole("link", { name: "Services" })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: "Pricing" })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: "About" })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: "FAQ" })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: "Reviews" })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: "Book now" })).toBeDefined();
      expect(within(mobileNav).getByRole("link", { name: "Contact" })).toBeDefined();
    });

    it("preserves menu accessibility after multiple viewport changes", () => {
      // Simulate real-world device rotation scenario
      setViewport(667, 375); // Landscape

      render(<NavBar />);

      const hamburgerButton = screen.getByLabelText("Toggle mobile menu");
      fireEvent.click(hamburgerButton);

      // Rotate to portrait
      setViewport(375, 667);
      fireEvent(window, new Event("resize"));

      // Rotate back to landscape
      setViewport(667, 375);
      fireEvent(window, new Event("resize"));

      // Menu should still be functional
      const mobileNav = screen.getByRole("navigation", { name: "Mobile navigation" });
      expect(hamburgerButton.getAttribute("aria-expanded")).toBe("true");
      expect(within(mobileNav).getByRole("link", { name: "Services" })).toBeDefined();
    });
  });
});
