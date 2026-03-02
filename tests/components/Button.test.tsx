/**
 * @file tests/components/Button.test.tsx
 * @description Unit tests for polymorphic Button component
 * @severity S1 - Core design system component
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Button, type ButtonVariant, type ButtonSize } from "@/components/Button";

describe("Button Component", () => {
  describe("Polymorphic rendering", () => {
    it("renders as Next.js Link when href is provided", () => {
      render(<Button href="/test">Link Button</Button>);
      const element = screen.getByRole("link");
      expect(element).toBeDefined();
      expect(element.getAttribute("href")).toBe("/test");
    });

    it("renders as native button when href is not provided", () => {
      render(<Button>Native Button</Button>);
      const element = screen.getByRole("button");
      expect(element).toBeDefined();
      expect(element.tagName).toBe("BUTTON");
    });

    it("renders as button with type=submit", () => {
      render(<Button type="submit">Submit</Button>);
      const element = screen.getByRole("button");
      expect(element.getAttribute("type")).toBe("submit");
    });

    it("renders as button with type=button by default", () => {
      render(<Button>Default</Button>);
      const element = screen.getByRole("button");
      expect(element.getAttribute("type")).toBe("button");
    });
  });

  describe("Variant styles", () => {
    const variants: ButtonVariant[] = ["primary", "secondary", "tertiary", "ghost"];

    variants.forEach((variant) => {
      it(`applies ${variant} variant classes`, () => {
        render(<Button variant={variant}>Test</Button>);
        const element = screen.getByRole("button");
        const classList = element.className;

        switch (variant) {
          case "primary":
            expect(classList).toContain("bg-coquelicot-500");
            expect(classList).toContain("text-rich-black");
            break;
          case "secondary":
            expect(classList).toContain("bg-russian-violet");
            expect(classList).toContain("text-seasalt");
            break;
          case "tertiary":
            expect(classList).toContain("bg-moonstone-600");
            expect(classList).toContain("text-russian-violet");
            break;
          case "ghost":
            expect(classList).toContain("bg-transparent");
            expect(classList).toContain("border-russian-violet/40");
            break;
        }
      });
    });

    it("defaults to primary variant when not specified", () => {
      render(<Button>Default Variant</Button>);
      const element = screen.getByRole("button");
      expect(element.className).toContain("bg-coquelicot-500");
    });
  });

  describe("Size styles", () => {
    const sizes: { size: ButtonSize; height: string; padding: string; fontSize: string }[] = [
      { size: "sm", height: "h-9", padding: "px-4", fontSize: "text-sm" },
      { size: "md", height: "h-12", padding: "px-5", fontSize: "text-base" },
      { size: "lg", height: "h-14", padding: "px-6", fontSize: "text-lg" },
    ];

    sizes.forEach(({ size, height, padding, fontSize }) => {
      it(`applies ${size} size classes`, () => {
        render(<Button size={size}>Test</Button>);
        const element = screen.getByRole("button");
        const classList = element.className;
        expect(classList).toContain(height);
        expect(classList).toContain(padding);
        expect(classList).toContain(fontSize);
      });
    });

    it("defaults to md size when not specified", () => {
      render(<Button>Default Size</Button>);
      const element = screen.getByRole("button");
      expect(element.className).toContain("h-12");
      expect(element.className).toContain("px-5");
      expect(element.className).toContain("text-base");
    });
  });

  describe("Variant × Size combinations", () => {
    const variants: ButtonVariant[] = ["primary", "secondary", "tertiary", "ghost"];
    const sizes: ButtonSize[] = ["sm", "md", "lg"];

    // Test all 12 combinations
    variants.forEach((variant) => {
      sizes.forEach((size) => {
        it(`renders ${variant} variant with ${size} size`, () => {
          render(
            <Button variant={variant} size={size}>
              {variant}-{size}
            </Button>,
          );
          const element = screen.getByRole("button");
          expect(element).toBeDefined();
          expect(element.textContent).toBe(`${variant}-${size}`);
        });
      });
    });
  });

  describe("Disabled state", () => {
    it("applies disabled classes to button", () => {
      render(<Button disabled>Disabled</Button>);
      const element = screen.getByRole("button");
      expect(element.className).toContain("opacity-60");
      expect(element.className).toContain("cursor-not-allowed");
      expect(element.getAttribute("disabled")).toBe("");
    });

    it("applies disabled classes to Link (visual only)", () => {
      render(
        <Button href="/test" disabled>
          Disabled Link
        </Button>,
      );
      const element = screen.getByRole("link");
      expect(element.className).toContain("opacity-60");
      expect(element.className).toContain("cursor-not-allowed");
      // Note: Link is not actually disabled (still navigable)
      // This is expected behavior - documented in component
    });

    it("sets aria-disabled on button when disabled", () => {
      render(<Button disabled>Disabled</Button>);
      const element = screen.getByRole("button");
      expect(element.getAttribute("aria-disabled")).toBe("true");
    });
  });

  describe("Full width", () => {
    it("applies w-full class when fullWidth is true", () => {
      render(<Button fullWidth>Full Width</Button>);
      const element = screen.getByRole("button");
      expect(element.className).toContain("w-full");
    });

    it("does not apply w-full by default", () => {
      render(<Button>Regular Width</Button>);
      const element = screen.getByRole("button");
      expect(element.className).not.toContain("w-full");
    });
  });

  describe("Custom className", () => {
    it("merges custom className with base classes", () => {
      render(<Button className="custom-class">Custom</Button>);
      const element = screen.getByRole("button");
      expect(element.className).toContain("custom-class");
      expect(element.className).toContain("rounded-lg"); // base class still present
    });
  });

  describe("Children rendering", () => {
    it("renders text children", () => {
      render(<Button>Text Content</Button>);
      expect(screen.getByText("Text Content")).toBeDefined();
    });

    it("renders icon + text children", () => {
      render(
        <Button>
          <span data-testid="icon">📅</span>
          Book Now
        </Button>,
      );
      expect(screen.getByTestId("icon")).toBeDefined();
      expect(screen.getByText("Book Now")).toBeDefined();
    });
  });

  describe("Accessibility", () => {
    it("supports aria-label on button", () => {
      render(<Button aria-label="Close dialog">×</Button>);
      const element = screen.getByRole("button");
      expect(element.getAttribute("aria-label")).toBe("Close dialog");
    });

    it("supports aria-label on Link", () => {
      render(
        <Button href="/test" aria-label="Navigate to test">
          Go
        </Button>,
      );
      const element = screen.getByRole("link");
      expect(element.getAttribute("aria-label")).toBe("Navigate to test");
    });

    it("supports aria-current on Link", () => {
      render(
        <Button href="/current" aria-current="page">
          Current Page
        </Button>,
      );
      const element = screen.getByRole("link");
      expect(element.getAttribute("aria-current")).toBe("page");
    });

    it("applies inline-flex with gap for icon alignment", () => {
      render(<Button>Test</Button>);
      const element = screen.getByRole("button");
      expect(element.className).toContain("inline-flex");
      expect(element.className).toContain("gap-2");
    });
  });

  describe("Next.js Link props", () => {
    it("passes prefetch prop to Link", () => {
      render(
        <Button href="/test" prefetch={false}>
          No Prefetch
        </Button>,
      );
      // Note: Testing Link props directly is difficult without mocking Next.js
      // This test verifies the component accepts the prop without errors
      const element = screen.getByRole("link");
      expect(element).toBeDefined();
    });

    it("passes scroll prop to Link", () => {
      render(
        <Button href="/test" scroll={false}>
          No Scroll
        </Button>,
      );
      const element = screen.getByRole("link");
      expect(element).toBeDefined();
    });
  });

  describe("Base classes", () => {
    it("applies rounded-lg to all buttons", () => {
      render(<Button>Test</Button>);
      const element = screen.getByRole("button");
      expect(element.className).toContain("rounded-lg");
    });

    it("applies font-bold to all buttons", () => {
      render(<Button>Test</Button>);
      const element = screen.getByRole("button");
      expect(element.className).toContain("font-bold");
    });

    it("applies whitespace-nowrap to prevent text wrapping", () => {
      render(<Button>Test</Button>);
      const element = screen.getByRole("button");
      expect(element.className).toContain("whitespace-nowrap");
    });
  });

  describe("Height consistency", () => {
    it("renders same-size buttons with consistent classes", () => {
      const { container } = render(
        <div>
          <Button size="md" variant="primary">
            Button 1
          </Button>
          <Button size="md" variant="secondary">
            Button 2
          </Button>
        </div>,
      );
      const buttons = container.querySelectorAll("button");
      const class1 = buttons[0].className;
      const class2 = buttons[1].className;

      // Both should have the same explicit height, padding, and font size
      expect(class1).toContain("h-12");
      expect(class2).toContain("h-12");
      expect(class1).toContain("px-5");
      expect(class2).toContain("px-5");
      expect(class1).toContain("text-base");
      expect(class2).toContain("text-base");
    });
  });
});
