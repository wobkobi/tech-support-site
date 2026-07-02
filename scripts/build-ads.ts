// scripts/build-ads.ts
/**
 * @file build-ads.ts
 * @description Generates Meta (Facebook/Instagram) ad creatives by rendering
 * branded HTML with Puppeteer and screenshotting it at the exact ad sizes
 * (1:1 Feed, 4:5 Feed, 9:16 Stories/Reels, 1.91:1 right column). Follows Meta's
 * image-ad guidance: ONE message per image - a 3-layer stack of brand logo, one
 * big outcome headline, and one short support line (no benefits list, no fake
 * buttons; the feed chrome + Meta's own CTA button carry name/URL/CTA). The
 * frosted card mirrors the website's FrostedSection. The 9:16 keeps its content
 * in the vertical safe zone (Meta overlays UI top/bottom). Edit AD_COPY /
 * AD_SPECS / STYLES below and re-run. Output lands in ad-creatives/ (not served
 * or committed).
 * Run with: npm run build:ads
 */

import fs from "node:fs";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer";
import { BACKDROP, LOGO_FULL, LOGO_PROFILE, PALETTE } from "./build-icons/config.js";

/* ---------- Editable copy ---------- */

/**
 * On-image wording. Kept to the guide's two lines: an outcome-led headline
 * (the hook) and a short support line (the proof). The logo is the third layer.
 */
const AD_COPY = {
  headline: "Friendly local IT support",
  // Feed tiles (small) use the single support line; the full-screen 9:16 has
  // room for the fuller check list instead.
  support: "No jargon · Fair pricing · On-site & remote",
  bullets: [
    "No jargon, ever",
    "Transparent, fair pricing",
    "Same-day, evenings & weekends",
    "On-site & remote help",
  ],
} as const;

/* ---------- Output specs ---------- */

/** Layout template a spec renders with. */
type AdTemplate = "tall" | "portrait" | "square" | "wide";

/** Which logo art to place: the square profile mark or the wide wordmark. */
type LogoKind = "square" | "wordmark";

/** One ad creative to render. */
interface AdSpec {
  /** Output filename (written into ad-creatives/). */
  name: string;
  /** Canvas width in pixels (CSS layout size; output is SCALE x this). */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /** Which layout to use. */
  template: AdTemplate;
  /** Which logo art to use (square profile mark reads better on 1:1 / 9:16). */
  logo: LogoKind;
}

const OUTPUT_DIR = "ad-creatives";

// Export at 2x the layout size for crisp text/logo on high-DPI phones. Meta
// downsizes per placement; the blurred 3456x2304 backdrop upscales invisibly.
const SCALE = 2;

const AD_SPECS: AdSpec[] = [
  // Feed / Instagram Feed / Explore / Marketplace - Meta's recommended image
  // ratio. Shown small in reels tiles, so it gets the biggest headline.
  {
    name: "meta-ad-4x5-2160x2700.jpg",
    width: 1080,
    height: 1350,
    template: "portrait",
    logo: "square",
  },
  // Feeds + in-stream reels (square) - usually shown near full width.
  {
    name: "meta-ad-1x1-2160x2160.jpg",
    width: 1080,
    height: 1080,
    template: "square",
    logo: "square",
  },
  // Stories / Reels / Status / Search (full-screen vertical) - safe-zone laid out.
  {
    name: "meta-ad-9x16-2160x3840.jpg",
    width: 1080,
    height: 1920,
    template: "tall",
    logo: "square",
  },
  // Right column / Search results (landscape) - wide wordmark suits the format.
  {
    name: "meta-ad-1.91x1-2400x1256.jpg",
    width: 1200,
    height: 628,
    template: "wide",
    logo: "wordmark",
  },
];

/* ---------- Palette (from the site's design tokens) ---------- */

const NAVY = PALETTE.russianViolet500; // headline + support
const SEASALT = PALETTE.seasalt500;
const MOON = PALETTE.moonstone500; // #43bccd - check badge + backdrop scrim tint
const MOON_ICON = "#2d9cab"; // moonstone-400 - readable check stroke

// Moonstone circle-badge tick for the 9:16 check list (matches the site).
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="${MOON_ICON}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---------- Styling ---------- */

/**
 * Full stylesheet. Base rules mirror the website (frosted card, brand colours);
 * `.tall` / `.portrait` / `.square` / `.wide` blocks hold every size so tweaking
 * one dimension never touches the markup. The card is sized to its content and
 * vertically centred so the backdrop frames it (the 9:16 nudges up via `top` to
 * sit in the Stories safe zone). One focal point: the headline is the largest
 * element; the logo is the brand mark above it.
 */
const STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: "Exo", sans-serif; }
  .stage { position: relative; overflow: hidden; }

  /* Light, airy blurred backdrop - the same image the site sits on. Kept light
     (only a soft scrim) so the frosted card reads through it. */
  .bg { position: absolute; inset: 0; background: url("__BG__") center/cover; filter: blur(24px) brightness(1.06) saturate(1.1); transform: scale(1.12); }
  .bg::after { content: ""; position: absolute; inset: 0; background: linear-gradient(160deg, ${SEASALT}4d, ${MOON}1a 65%, ${SEASALT}26); }

  /* Frosted seasalt card - matches the site's FrostedSection: bg-seasalt-800/60
     + seasalt-400/40 border + backdrop-blur. Sized to content, centred. */
  .card { position: absolute; left: 60px; right: 60px; top: 50%; transform: translateY(-50%); overflow: hidden; background: rgba(252,252,252,.6); border: 2px solid rgba(191,198,205,.4); box-shadow: 0 30px 80px rgba(12,10,62,.22); backdrop-filter: blur(14px); display: flex; flex-direction: column; align-items: center; text-align: center; }

  h1 { color: ${NAVY}; font-weight: 800; line-height: 1.08; letter-spacing: -0.5px; }
  .support { color: ${NAVY}; opacity: .78; font-weight: 600; }
  img.logo { display: block; }

  /* Check list - 9:16 only (full screen has room for the extra detail). */
  ul { list-style: none; display: flex; flex-direction: column; align-self: center; text-align: left; }
  li { display: flex; align-items: center; color: ${NAVY}; font-weight: 600; line-height: 1.15; }
  .badge { display: inline-flex; align-items: center; justify-content: center; flex: none; border-radius: 999px; border: 2px solid ${MOON}80; background: ${MOON}4d; }
  .badge svg { width: 56%; height: 56%; }

  /* --- Portrait 4:5 (Meta's recommended image ratio; tiny in reels tiles) --- */
  .portrait.card { left: 120px; right: 120px; padding: 96px 50px; border-radius: 44px; gap: 84px; }
  .portrait img.logo { width: 720px; }
  .portrait img.logo-sq { width: 680px; }
  .portrait h1 { font-size: 92px; max-width: 960px; }
  .portrait .support { font-size: 50px; max-width: 900px; line-height: 1.3; }

  /* --- Square 1:1 (shown near full width) --- */
  .square.card { padding: 60px 60px; border-radius: 40px; gap: 38px; }
  .square img.logo { width: 720px; }
  .square img.logo-sq { width: 560px; }
  .square h1 { font-size: 74px; max-width: 940px; }
  .square .support { font-size: 42px; max-width: 860px; line-height: 1.3; }

  /* --- Vertical 9:16 (Stories/Reels) ---
     Meta overlays UI top ~14% / bottom ~35%; top:40% keeps content in the
     middle safe zone, clear of the profile bar and CTA. */
  .tall.card { padding: 76px 72px; border-radius: 46px; gap: 40px; }
  .tall img.logo-sq { width: 640px; }
  .tall h1 { font-size: 58px; max-width: 900px; }
  .tall ul { gap: 32px; font-size: 43px; }
  .tall li { gap: 26px; }
  .tall .badge { width: 1.5em; height: 1.5em; }

  /* --- Landscape 1.91:1 (right column / search) --- */
  .wide.card { padding: 56px 64px; border-radius: 36px; gap: 22px; }
  .wide img.logo { width: 740px; }
  .wide h1 { font-size: 58px; max-width: 1040px; }
  .wide .support { font-size: 32px; max-width: 1000px; line-height: 1.3; }
`;

/* ---------- Asset loading ---------- */

/**
 * Read a file and wrap it as a base64 data URI so the rendered page needs no
 * local server or network for its imagery.
 * @param file - Path to the asset, relative to the current working directory.
 * @param mime - MIME type to embed in the data URI.
 * @returns The asset as a `data:` URI string.
 */
function dataUri(file: string, mime: string): string {
  const b64 = fs.readFileSync(path.resolve(file)).toString("base64");
  return `data:${mime};base64,${b64}`;
}

const LOGO_URI: Record<LogoKind, string> = {
  wordmark: dataUri(LOGO_FULL, "image/svg+xml"),
  square: dataUri(LOGO_PROFILE, "image/svg+xml"),
};
const BG_URI = dataUri(BACKDROP, "image/jpeg");

/* ---------- HTML building blocks ---------- */

/**
 * Render the logo `<img>` for a spec. The `logo-sq` class lets the square
 * profile mark size independently of the wide wordmark.
 * @param spec - The spec being rendered (chooses the logo art).
 * @returns HTML string for the logo image.
 */
function logoImg(spec: AdSpec): string {
  const cls = spec.logo === "square" ? "logo logo-sq" : "logo";
  return `<img class="${cls}" src="${LOGO_URI[spec.logo]}" alt="" />`;
}

/**
 * Render one moonstone circle-badge + label list item (9:16 check list).
 * @param text - Bullet label (may contain HTML entities).
 * @returns HTML string for a single `<li>`.
 */
function bullet(text: string): string {
  return `<li><span class="badge">${ICON_CHECK}</span><span>${text}</span></li>`;
}

/**
 * Wrap card contents in the full document, sized to the spec.
 * @param spec - The spec being rendered (canvas dimensions + template class).
 * @param inner - Card inner markup.
 * @returns Full HTML document string.
 */
function wrapHtml(spec: AdSpec, inner: string): string {
  const css = STYLES.replace("__BG__", BG_URI);
  return `<!doctype html><html><head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Exo:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>${css}</style>
</head><body>
<div class="stage" style="width:${spec.width}px;height:${spec.height}px;">
  <div class="bg"></div>
  <div class="card ${spec.template}">${inner}</div>
</div>
</body></html>`;
}

/**
 * Build a creative: brand logo, one big outcome headline, one support line.
 * Same markup for every format; sizes come from the template's CSS block.
 * @param spec - The spec being rendered.
 * @returns Full HTML document string.
 */
function adHtml(spec: AdSpec): string {
  // Full-screen 9:16 shows the fuller check list; the 4:5 is logo + headline
  // only (cleanest for the tiny reels tile); other feed tiles get the support
  // line.
  let detail = `<p class="support">${AD_COPY.support}</p>`;
  if (spec.template === "tall") {
    detail = `<ul>${AD_COPY.bullets.map(bullet).join("")}</ul>`;
  } else if (spec.template === "portrait") {
    detail = "";
  }
  // 1:1 and 4:5 break the headline as "Friendly local" / "IT support"; the
  // 9:16 and 1.91:1 wrap naturally.
  const twoLine = spec.template === "square" || spec.template === "portrait";
  const headline = twoLine ? AD_COPY.headline.replace(/\s+IT\b/, "<br>IT") : AD_COPY.headline;
  const inner = `
    ${logoImg(spec)}
    <h1>${headline}</h1>
    ${detail}`;
  return wrapHtml(spec, inner);
}

/* ---------- Rendering ---------- */

/**
 * Render a single ad spec to a JPEG file via a headless page screenshot.
 * @param browser - Shared Puppeteer browser instance.
 * @param spec - The ad creative to render.
 * @returns Absolute path of the written file.
 */
async function renderAd(browser: Browser, spec: AdSpec): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: spec.width, height: spec.height, deviceScaleFactor: SCALE });
    await page.setContent(adHtml(spec), { waitUntil: "load", timeout: 30000 });
    // Wait for the web font so text metrics match the final render.
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await new Promise((resolve) => setTimeout(resolve, 400));

    const outPath = path.resolve(OUTPUT_DIR, spec.name);
    await page.screenshot({ path: outPath, type: "jpeg", quality: 92, fullPage: false });
    return outPath;
  } finally {
    await page.close();
  }
}

/* ---------- Entry point ---------- */

(async () => {
  const start = Date.now();
  fs.mkdirSync(path.resolve(OUTPUT_DIR), { recursive: true });

  console.log("🖼️  Building Meta ad creatives...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    for (const spec of AD_SPECS) {
      const out = await renderAd(browser, spec);
      console.log(`  ✓ ${spec.name} (${spec.width * SCALE}x${spec.height * SCALE})`);
      const sizeKb = (fs.statSync(out).size / 1024).toFixed(0);
      console.log(`    ${out} (${sizeKb} KB)`);
    }
  } finally {
    await browser.close();
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✓ Done in ${elapsed}s > ${path.resolve(OUTPUT_DIR)}`);
})();
