// src/shared/lib/google-maps-loader.ts - loads the Maps JS API once
// (loading=async) and resolves the Places library via importLibrary.

/** Global callback name the Maps bootstrap invokes when the API is ready. */
const READY_CALLBACK = "__gmapsLoaderReady";

/**
 * Shared bootstrap promise. With loading=async the script's load event fires
 * BEFORE importLibrary exists - only the callback param signals readiness.
 */
let bootstrapPromise: Promise<void> | null = null;

/**
 * Injects the Maps bootstrap script and resolves once the API has initialised.
 * @param apiKey - Maps API key.
 * @returns Shared promise settling when the API is ready (or the script fails).
 */
function bootstrap(apiKey: string): Promise<void> {
  bootstrapPromise ??= new Promise<void>((resolve, reject) => {
    // Dev HMR can reset the promise cache while a tag exists - poll it rather
    // than double-loading the API with a second bootstrap.
    const existing = document.querySelector<HTMLScriptElement>('script[data-gmaps-loader="true"]');
    if (existing) {
      const poll = setInterval(() => {
        if (typeof window.google?.maps?.importLibrary === "function") {
          clearInterval(poll);
          resolve();
        }
      }, 50);
      setTimeout(() => {
        clearInterval(poll);
        reject(new Error("Maps script never initialised"));
        bootstrapPromise = null;
      }, 15_000);
      return;
    }

    /** Invoked by the Maps bootstrap once the API is fully initialised. */
    const onReady = (): void => {
      delete (window as unknown as Record<string, unknown>)[READY_CALLBACK];
      resolve();
    };
    (window as unknown as Record<string, unknown>)[READY_CALLBACK] = onReady;
    const script = document.createElement("script");
    script.dataset.gmapsLoader = "true";
    // No libraries= param (importLibrary fetches on demand); loading=async
    // silences Google's loading-pattern console warning.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&loading=async&callback=${READY_CALLBACK}`;
    script.async = true;
    script.addEventListener("error", () => {
      // Reset the cache so a later call retries with a fresh tag.
      bootstrapPromise = null;
      script.remove();
      reject(new Error("Maps script failed to load"));
    });
    document.head.appendChild(script);
  });
  return bootstrapPromise;
}

/**
 * Loads the Maps bootstrap once and imports the Places library.
 * @param apiKey - Maps API key.
 * @returns The Places library object.
 */
export async function loadPlacesLibrary(apiKey: string): Promise<google.maps.PlacesLibrary> {
  if (typeof window === "undefined") {
    throw new Error("loadPlacesLibrary is browser-only");
  }
  // typeof, not truthiness: the typings declare importLibrary non-optional,
  // but at runtime it only exists once the bootstrap has run.
  if (typeof window.google?.maps?.importLibrary !== "function") {
    await bootstrap(apiKey);
  }
  return await google.maps.importLibrary("places");
}
