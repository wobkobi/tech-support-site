// src/shared/types/google-maps.d.ts
// Global type augmentation for Google Maps API on window.

/// <reference types="@types/google.maps" />

export {};

declare global {
  interface Window {
    google?: typeof google;
  }
}
