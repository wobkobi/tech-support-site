/**
 * @file tests/components/Reviews.scale.test.tsx
 * @description Test Reviews component with various numbers of reviews (0, 1-3, 4+)
 * @severity S2 - Performance and layout correctness with many reviews
 */

import { render } from "@testing-library/react";
import Reviews, { type ReviewItem } from "@/components/Reviews";
import { describe, it, expect } from "vitest";

/**
 * Creates a single mock review item for testing.
 * @param index - Index number for the review.
 * @param overrides - Optional partial overrides for review properties.
 * @returns A ReviewItem object.
 */
function createReview(index: number, overrides?: Partial<ReviewItem>): ReviewItem {
  return {
    text: `This is review number ${index + 1}. Great service and very helpful!`,
    firstName: `John${index}`,
    lastName: `Doe${index}`,
    isAnonymous: false,
    ...overrides,
  };
}

/**
 * Creates multiple mock review items for testing.
 * @param count - Number of reviews to create.
 * @param overrides - Optional partial overrides applied to all reviews.
 * @returns An array of ReviewItem objects.
 */
function createReviews(count: number, overrides?: Partial<ReviewItem>): ReviewItem[] {
  return Array.from({ length: count }, (_, i) => createReview(i, overrides));
}

describe("Reviews Component - Scale Test", () => {
  describe("Empty state (0 reviews)", () => {
    it("returns null when no reviews provided", () => {
      const { container } = render(<Reviews items={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it("returns null when items prop is undefined", () => {
      const { container } = render(<Reviews />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe("Small scale (1-3 reviews)", () => {
    it("renders 1 review in regular card layout", () => {
      const items = createReviews(1);
      const { container } = render(<Reviews items={items} />);
      const cards = container.querySelectorAll("li");
      expect(cards.length).toBe(1);
      expect(container.textContent).toContain("J. Doe0."); // formatName abbreviates first name
    });

    it("renders 2 reviews in regular card layout", () => {
      const items = createReviews(2);
      const { container } = render(<Reviews items={items} />);
      const cards = container.querySelectorAll("li");
      expect(cards.length).toBe(2);
    });

    it("renders 3 reviews in regular card layout (no marquee)", () => {
      const items = createReviews(3);
      const { container } = render(<Reviews items={items} />);
      const cards = container.querySelectorAll("li");
      expect(cards.length).toBe(3);
      // Verify no marquee animation class
      const marqueeTrack = container.querySelector(".marquee-track");
      expect(marqueeTrack).toBeNull();
    });

    it("centers cards with flex-wrap layout for 1-3 items", () => {
      const items = createReviews(2);
      const { container } = render(<Reviews items={items} />);
      const list = container.querySelector("ul");
      expect(list?.className).toContain("flex-wrap");
      expect(list?.className).toContain("justify-center");
    });
  });

  describe("Large scale (4+ reviews) - Marquee mode", () => {
    it("switches to marquee layout with 4 reviews", () => {
      const items = createReviews(4);
      const { container } = render(<Reviews items={items} />);
      const marqueeTrack = container.querySelector(".marquee-track");
      expect(marqueeTrack).toBeTruthy();
      expect(marqueeTrack?.className).toContain("animate-marquee");
    });

    it("duplicates reviews for seamless marquee scrolling (4 items → 8 rendered)", () => {
      const items = createReviews(4);
      const { container } = render(<Reviews items={items} />);
      const cards = container.querySelectorAll("li");
      // Should be 4 items × 2 (duplicated for seamless loop)
      expect(cards.length).toBe(8);
    });

    it("duplicates reviews for seamless marquee scrolling (10 items → 20 rendered)", () => {
      const items = createReviews(10);
      const { container } = render(<Reviews items={items} />);
      const cards = container.querySelectorAll("li");
      expect(cards.length).toBe(20);
    });

    it("handles 50 reviews without performance degradation", () => {
      const items = createReviews(50);
      const start = performance.now();
      const { container } = render(<Reviews items={items} />);
      const end = performance.now();

      const cards = container.querySelectorAll("li");
      expect(cards.length).toBe(100); // 50 × 2 for marquee
      // Should render in <1000ms
      expect(end - start).toBeLessThan(300);
    });

    it("handles 100 reviews without performance degradation", () => {
      const items = createReviews(100);
      const start = performance.now();
      const { container } = render(<Reviews items={items} />);
      const end = performance.now();

      const cards = container.querySelectorAll("li");
      expect(cards.length).toBe(200); // 100 × 2
      // Should render in <500ms
      expect(end - start).toBeLessThan(500);
    });
  });

  describe("Review text content handling", () => {
    it("renders short review text correctly", () => {
      const items = [
        {
          text: "Short review",
          firstName: "John",
          lastName: "Doe",
          isAnonymous: false,
        },
      ];
      const { container } = render(<Reviews items={items} />);
      expect(container.textContent).toContain("Short review");
    });

    it("renders very long review text without layout break", () => {
      const longText = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(10);
      const items = [
        {
          text: longText,
          firstName: "John",
          lastName: "Doe",
          isAnonymous: false,
        },
      ];
      const { container } = render(<Reviews items={items} />);
      const card = container.querySelector("li");
      // Card should wrap text without breaking layout
      expect(card?.textContent).toContain("Lorem ipsum");
      expect(card?.className).toMatch(/flex.*flex-col/);
    });

    it("renders review with special characters and emojis", () => {
      const items = [
        {
          text: "Great service! 👍 Really appreciate it & the support.",
          firstName: "Jane",
          lastName: "Smith",
          isAnonymous: false,
        },
      ];
      const { container } = render(<Reviews items={items} />);
      expect(container.textContent).toContain("👍");
      expect(container.textContent).toContain("&");
    });
  });

  describe("Name formatting edge cases", () => {
    it("formats normal first and last name", () => {
      const items = [
        {
          text: "Good service",
          firstName: "john",
          lastName: "smith",
          isAnonymous: false,
        },
      ];
      const { container } = render(<Reviews items={items} />);
      expect(container.textContent).toContain("J. Smith");
    });

    it("handles anonymous reviews", () => {
      const items = [
        {
          text: "Anonymous review",
          firstName: "John",
          lastName: "Doe",
          isAnonymous: true,
        },
      ];
      const { container } = render(<Reviews items={items} />);
      expect(container.textContent).toContain("Anonymous");
      expect(container.textContent).not.toContain("John");
    });

    it("handles missing first name", () => {
      const items = [
        {
          text: "Review text",
          firstName: null,
          lastName: "Smith",
          isAnonymous: false,
        },
      ];
      const { container } = render(<Reviews items={items} />);
      expect(container.textContent).toContain("Smith."); // no initial when firstName missing
    });

    it("handles missing last name", () => {
      const items = [
        {
          text: "Review text",
          firstName: "John",
          lastName: null,
          isAnonymous: false,
        },
      ];
      const { container } = render(<Reviews items={items} />);
      expect(container.textContent).toContain("J.");
    });

    it("handles both names missing (falls back to Anonymous)", () => {
      const items = [
        {
          text: "Review text",
          firstName: null,
          lastName: null,
          isAnonymous: false,
        },
      ];
      const { container } = render(<Reviews items={items} />);
      expect(container.textContent).toContain("Anonymous");
    });

    it("handles empty string names", () => {
      const items = [
        {
          text: "Review text",
          firstName: "   ",
          lastName: "   ",
          isAnonymous: false,
        },
      ];
      const { container } = render(<Reviews items={items} />);
      expect(container.textContent).toContain("Anonymous");
    });
  });

  describe("Accessibility", () => {
    it("has section with proper aria-labelledby", () => {
      const items = createReviews(2);
      const { container } = render(<Reviews items={items} />);
      const section = container.querySelector("section");
      expect(section?.getAttribute("aria-labelledby")).toBe("reviews");
    });

    it("has heading with id='reviews' for aria-labelledby", () => {
      const items = createReviews(2);
      const { container } = render(<Reviews items={items} />);
      const heading = container.querySelector("h2");
      expect(heading?.id).toBe("reviews");
      expect(heading?.textContent).toContain("What People Say");
    });

    it("uses semantic list element (ul > li)", () => {
      const items = createReviews(3);
      const { container } = render(<Reviews items={items} />);
      expect(container.querySelector("ul")).toBeTruthy();
      expect(container.querySelectorAll("li").length).toBeGreaterThan(0);
    });

    it("renders heading for visibility in large scale view", () => {
      const items = createReviews(20);
      const { container } = render(<Reviews items={items} />);
      const heading = container.querySelector("h2");
      expect(heading?.textContent).toBe("What People Say");
    });
  });

  describe("Responsive layout", () => {
    it("applies responsive width classes to cards (1-3 items)", () => {
      const items = createReviews(2);
      const { container } = render(<Reviews items={items} />);
      const cards = container.querySelectorAll("li");
      cards.forEach((card) => {
        // Should have responsive width: full on mobile, 50% on sm, 33% on md
        expect(card.className).toMatch(/w-full\s+sm:w-\[calc\(50%-.*\)\]\s+md:w-\[calc\(33/);
      });
    });

    it("applies fixed width to marquee cards (4+ items)", () => {
      const items = createReviews(5);
      const { container } = render(<Reviews items={items} />);
      const cards = container.querySelectorAll("li");
      cards.forEach((card) => {
        // Marquee cards have responsive width (w-[min(...)] sm:w-95)
        expect(card.className).toMatch(/w-\[min\(.*\)\].*sm:w-95|sm:w-95.*w-\[min\(.*\)\]/);
      });
    });
  });

  describe("Key uniqueness (no console warnings)", () => {
    it("does not duplicate keys in flat list (1-3 items)", () => {
      const items = [
        { text: "Review 1", firstName: "John", lastName: "A", isAnonymous: false },
        { text: "Review 2", firstName: "Jane", lastName: "B", isAnonymous: false },
      ];
      const { container } = render(<Reviews items={items} />);
      const cards = container.querySelectorAll("li");
      expect(cards.length).toBe(2); // No duplication
    });

    it("handles key generation in marquee with duplicated items", () => {
      // Marquee duplicates items but appends index to make keys unique
      const items = createReviews(4); // 4+ items trigger marquee
      const { container } = render(<Reviews items={items} />);
      const cards = container.querySelectorAll("li");
      expect(cards.length).toBe(8); // 4 original + 4 duplicated
    });
  });
});
