"use client";
// src/features/social-design/components/canvas/icon-art.tsx
// Icon layers' artwork. react-icons are React SVG components, so each one renders to
// SVG markup once per icon and colour and draws on the canvas as a data-URI image.
// Data URIs are same-origin, so the canvas stays exportable.

import type { ComponentType } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { IconBaseProps } from "react-icons";
import {
  FaBolt,
  FaBug,
  FaBuilding,
  FaCalendarCheck,
  FaCamera,
  FaCar,
  FaCircleCheck,
  FaClock,
  FaCloud,
  FaComments,
  FaDatabase,
  FaDesktop,
  FaEnvelope,
  FaGamepad,
  FaGear,
  FaGift,
  FaHardDrive,
  FaHeadset,
  FaHeart,
  FaHouse,
  FaKey,
  FaLaptop,
  FaLightbulb,
  FaLocationDot,
  FaLock,
  FaMobileScreen,
  FaPercent,
  FaPrint,
  FaRotate,
  FaRoute,
  FaScrewdriverWrench,
  FaShieldHalved,
  FaTabletScreenButton,
  FaTag,
  FaThumbsUp,
  FaTv,
  FaVideo,
  FaWifi,
} from "react-icons/fa6";

// Must hold every name in lib/icons.ts ICON_CHOICES; the check script compares them.
export const ICON_ART: Record<string, ComponentType<IconBaseProps>> = {
  FaBolt,
  FaBug,
  FaBuilding,
  FaCalendarCheck,
  FaCamera,
  FaCar,
  FaCircleCheck,
  FaClock,
  FaCloud,
  FaComments,
  FaDatabase,
  FaDesktop,
  FaEnvelope,
  FaGamepad,
  FaGear,
  FaGift,
  FaHardDrive,
  FaHeadset,
  FaHeart,
  FaHouse,
  FaKey,
  FaLaptop,
  FaLightbulb,
  FaLocationDot,
  FaLock,
  FaMobileScreen,
  FaPercent,
  FaPrint,
  FaRotate,
  FaRoute,
  FaScrewdriverWrench,
  FaShieldHalved,
  FaTabletScreenButton,
  FaTag,
  FaThumbsUp,
  FaTv,
  FaVideo,
  FaWifi,
};

const cache = new Map<string, string>();

/**
 * An icon as an SVG data URI in one colour. Drawn 512 square: wide icons sit centred
 * inside it, so every icon fills its box the same way.
 * @param name - Icon component name.
 * @param hex - Colour.
 * @returns Data URI, or null for an unknown icon.
 */
export function iconDataUri(name: string, hex: string): string | null {
  const key = `${name}|${hex}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const Icon = ICON_ART[name];
  if (!Icon) return null;
  // currentColor has no CSS colour to resolve against once the SVG is an image.
  const svg = renderToStaticMarkup(createElement(Icon, { size: 512 })).replaceAll(
    "currentColor",
    hex,
  );
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}
