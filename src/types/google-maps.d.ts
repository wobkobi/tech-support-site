// src/types/google-maps.d.ts
/**
 * @file google-maps.d.ts
 * @description Global type augmentation for Google Maps API on window.
 */

export {};

declare global {
  interface Window {
    google?: typeof google;
  }
}
