// src/shared/types/fbq.d.ts
/**
 * @description Global type augmentation for the Meta Pixel (fbq) on window.
 */

export {};

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}
