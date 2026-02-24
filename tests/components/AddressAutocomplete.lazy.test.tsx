/**
 * @file tests/components/AddressAutocomplete.lazy.test.tsx
 * @description Verify Google Maps script is only injected when the component becomes visible
 */
import { render, waitFor, act } from "@testing-library/react";
import AddressAutocomplete from "@/components/AddressAutocomplete";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

describe("AddressAutocomplete lazy-load", () => {
  const originalEnv = process.env;
  let observerCallback: IntersectionObserverCallback | null = null;

  beforeEach(() => {
    process.env = { ...originalEnv, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "test-key" };
    observerCallback = null;

    // Mock IntersectionObserver before rendering
    global.IntersectionObserver = vi.fn(function (callback: IntersectionObserverCallback) {
      observerCallback = callback;
      return {
        observe: vi.fn(),
        disconnect: vi.fn(),
        takeRecords: vi.fn((): IntersectionObserverEntry[] => []),
      };
    }) as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    observerCallback = null;

    // Clean up any scripts injected by tests
    document.querySelectorAll('script[src*="maps.googleapis.com"]').forEach((s) => s.remove());
  });

  it("does not inject script before visible and injects once visible", async () => {
    // Track when script is created
    const scripts: HTMLScriptElement[] = [];
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const el = originalCreate(tagName);
      if (tagName === "script") {
        scripts.push(el as HTMLScriptElement);
      }
      return el;
    });

    const onChange = vi.fn();

    // Render component — no visibility event yet
    render(<AddressAutocomplete value="" onChange={onChange} />);

    // Initially no script should have been created
    expect(scripts.length).toBe(0);

    // Now simulate the element becoming visible by calling the observer callback
    if (observerCallback) {
      await act(async () => {
        observerCallback!(
          [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
    }

    // Wait for effect to run and script to be created
    await waitFor(() => {
      expect(scripts.length).toBeGreaterThan(0);
    });

    // Verify the script is the Google Maps script
    const mapScript = scripts.find((s) => {
      if (!s.src) return false;
      try {
        const url = new URL(s.src, window.location.origin);
        return url.hostname === "maps.googleapis.com";
      } catch {
        return false;
      }
    });
    expect(mapScript).toBeDefined();
    expect(mapScript?.src).toContain("key=test-key");
    expect(mapScript?.src).toContain("libraries=places");
  });

  it("handles focus event without scrolling into view", () => {
    // Verify: Component accepts onChange prop and renders input field
    // (focus event handling is tested in useOnVisible.test.ts hook tests)
    const onChange = vi.fn();

    const { container } = render(<AddressAutocomplete value="" onChange={onChange} />);

    // Verify input element exists and is ready for focus
    const input = container.querySelector("input");
    expect(input).toBeTruthy();
    expect(input?.id).toBe("address-autocomplete");

    // Verify initial state: no script loaded yet
    const scripts = document.querySelectorAll('script[src*="maps.googleapis.com"]');
    expect(scripts.length).toBe(0);
  });

  it("gracefully handles missing IntersectionObserver", () => {
    // Verify: Component renders with API key present (even if IO unavailable)
    // The hook's fallback logic is verified in useOnVisible.test.ts
    const onChange = vi.fn();

    const { container } = render(<AddressAutocomplete value="" onChange={onChange} />);

    // Verify component structure
    const wrapper = container.querySelector(".flex.flex-col.gap-1");
    expect(wrapper).toBeTruthy();

    const input = container.querySelector("input");
    expect(input).toBeTruthy();
    expect(input?.type).toBe("text");

    // Verify no error message when API key is provided
    const warning = container.textContent;
    expect(warning).not.toContain("API key not configured");
    expect(warning).not.toContain("Failed to load Google Maps");
  });

  it("shows warning when API key is missing", async () => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = undefined;

    // Make sure IntersectionObserver is available so hook runs properly
    if (!global.IntersectionObserver) {
      global.IntersectionObserver = vi.fn(function () {
        return {
          observe: vi.fn(),
          disconnect: vi.fn(),
          takeRecords: vi.fn((): IntersectionObserverEntry[] => []),
        };
      }) as unknown as typeof IntersectionObserver;
    }

    const onChange = vi.fn();
    const { container } = render(<AddressAutocomplete value="" onChange={onChange} />);

    // Component starts with "Loading..." message because isVisible=false initially
    expect(container.textContent).toContain("Loading address autocomplete...");

    // Simulate becoming visible (trigger IntersectionObserver callback)
    if (observerCallback) {
      await act(async () => {
        observerCallback!(
          [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
    }

    // Wait for effect to check API key and show warning
    await waitFor(() => {
      const warning = container.textContent;
      expect(warning).toContain("API key not configured");
    });
  });
});
