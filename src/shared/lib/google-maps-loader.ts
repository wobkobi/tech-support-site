// src/shared/lib/google-maps-loader.ts
/**
 * @description Loads the Maps JS API once (async, per Google's loading guidance)
 * and resolves the Places library via `google.maps.importLibrary`. Callers get
 * the library object holding the new Places classes (AutocompleteSuggestion,
 * AutocompleteSessionToken, Place) - the legacy `places.Autocomplete` widget is
 * no longer used anywhere.
 */

/** Global callback name the Maps bootstrap invokes when the API is ready. */
const READY_CALLBACK = "__gmapsLoaderReady";

/**
 * Module-level bootstrap promise so concurrent callers share one script load.
 * With `loading=async` the script tag's own `load` event fires BEFORE the API
 * has initialised (importLibrary isn't defined yet) - readiness is signalled
 * only through the `callback` query param, which is what resolves this.
 */
let bootstrapPromise: Promise<void> | null = null;

/**
 * Injects the Maps bootstrap script and resolves once the API has initialised.
 * @param apiKey - Maps API key.
 * @returns Shared promise settling when the API is ready (or the script fails).
 */
function bootstrap(apiKey: string): Promise<void> {
  bootstrapPromise ??= new Promise<void>((resolve, reject) => {
    // A tag can already exist while this module's promise cache is fresh (dev
    // HMR re-evaluates the module). Appending a second bootstrap would
    // double-load the API, so poll for readiness off the existing tag instead.
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
    // No `libraries=` param - importLibrary fetches Places on demand.
    // `loading=async` is Google's recommended pattern and silences the
    // "loaded directly without loading=async" console warning.
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&loading=async&callback=${READY_CALLBACK}`;
    script.async = true;
    script.addEventListener("error", () => {
      // Clear the cache so a later call can retry with a fresh tag instead of
      // waiting forever on a script whose error event has already fired.
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
  // Already initialised (e.g. by a previous page in the same session) -
  // importLibrary caches per-library, so repeat awaits are cheap. typeof check
  // rather than truthiness: the typings declare importLibrary non-optional,
  // but at runtime it only exists once the bootstrap has run.
  if (typeof window.google?.maps?.importLibrary !== "function") {
    await bootstrap(apiKey);
  }
  return (await google.maps.importLibrary("places")) as google.maps.PlacesLibrary;
}
