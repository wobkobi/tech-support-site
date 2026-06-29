// src/shared/types/gtag.d.ts
/**
 * @description Global type augmentation for the Google tag (gtag.js) on window.
 */

export {};

type GtagCommand = "js" | "config" | "event" | "set" | "consent";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (command: GtagCommand, ...args: unknown[]) => void;
  }
}
