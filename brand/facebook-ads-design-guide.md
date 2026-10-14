# Facebook Image Ads Design Guide

Verified against current Meta specs (2026). Meta removed the 20% text overlay rule in 2021, so text
on images is allowed, but cleaner images still perform better.

## 1. Sizes and specs

Design one 1:1 square (1080x1080) and one 4:5 vertical (1080x1350) and you cover almost every image
placement.

| Placement              | Ratio      | Recommended px        | Notes                                  |
| ---------------------- | ---------- | --------------------- | -------------------------------------- |
| Feed                   | 1:1 or 4:5 | 1080x1080 / 1080x1350 | 4:5 takes more screen height on mobile |
| Stories                | 9:16       | 1080x1920             | mind the safe zones below              |
| Marketplace            | 1:1        | 1080x1080             | square only                            |
| Right column (desktop) | 1:1        | 1080x1080             | small, keep it simple                  |
| Carousel (2-10 cards)  | 1:1 or 4:5 | 1080x1080             | each card is its own image             |

- Format: JPG or PNG (PNG for crisp text/logos, JPG for photos). Max 30 MB.
- Minimum width 600px, but never ship below 1080 or it looks pixelated. No max resolution, so upload
  high and let Meta downscale.
- 1:1 is the safest single size: it runs across Feed, Marketplace, and right column without
  cropping.

### Safe zones (Stories only)

UI sits on top of the image, so keep logos, text, and CTAs out of the top 14% and bottom 20%.
Everything important goes in the middle.

## 2. Text on the image vs text in the ad

Two separate things:

- **On-image text:** what you bake into the graphic. Keep it short, big, and high-contrast. One
  headline and maybe one supporting line. If someone has to squint, it's too much.
- **Ad copy (typed into Ads Manager):** primary text, headline, description. Design for mobile
  truncation, not the desktop max.

| Element      | Hard cap | Visible before "...more" |
| ------------ | -------- | ------------------------ |
| Primary text | 2,200    | ~125 (first 1-2 lines)   |
| Headline     | ~40      | ~25-30 on small screens  |
| Description  | ~30      | some placements only     |

Front-load the hook, offer, and key benefit into the first 125 characters, because most people never
tap "see more."

## 3. Visual design principles

- **One focal point.** One product, one message, one thing the eye lands on. Split attention kills
  recall.
- **Thumb-stop instantly.** People scroll fast. Interrupt the scroll with a face, a bold number,
  high contrast, or an unexpected image.
- **Readable at thumbnail size.** Preview it small on a phone at arm's length. If you can't read the
  headline, it fails.
- **Contrast the text off the background.** Put a solid shape, gradient, or darkened band behind
  on-image text so it never fights the photo.
- **Brand colour and logo present but subtle.** People should sense who it's from without the ad
  shouting.
- **Real photos beat stock.** Especially local, real, slightly imperfect ones. They read as
  authentic, not as an ad.
- **Whitespace is not wasted space.** Cramped ads look like spam. Give the message room.
- **Left-to-right, top-to-bottom.** Eyes land top-left. Put the hook there, the CTA lower.

## 4. On-image copy structure

Keep it to three layers max:

1. **Headline** (biggest): the hook or offer. "Same-day IT callouts."
2. **Support line** (smaller): the proof or detail. "No fix, no fee."
3. **CTA / brand** (smallest): who and what next. Logo plus "Message us."

The typed ad copy carries the rest. Don't try to say everything on the image.

## 5. For a local service business

Where a small operator out-punches big spenders, because you can be specific in ways they can't.

- **Name the suburb** on the image. "West Auckland" or an actual suburb feels made for them.
- **Show your face.** A photo of the person who turns up beats any logo for a sole trader. Lean into
  it.
- **Before/after or problem/solution.** Split-screen (dead device then working, messy then tidy)
  communicates instantly with zero reading.
- **Testimonial as the creative.** A clean quote card with a first name and suburb outperforms
  polished stock for local trust.
- **One offer per image.** A single bold promise beats a menu of services.
- **Lead with the outcome, not the tech.** People buy "working again today," not a list of acronyms.

Carousels suit a service business: one card per common problem you fix, each with its own headline
and CTA.

## 6. Testing

- Run 3-4 image variations against the same audience, vary one thing at a time (image, then
  headline, then CTA), and let spend flow to the winner.
- Preview across placements before publishing. Advantage+ auto-crops into 9:16 / 1:1 / 4:5 and the
  results are hit and miss, so eyeball every version.
- Watch thumbstop / hook rate. If people aren't stopping, the creative is the problem, not the
  offer.
- Refresh creative every few weeks. The same image shown too long fatigues and CPMs climb.

## Quick pre-flight checklist

- [ ] 1080px minimum, correct ratio for the placement
- [ ] Readable at thumbnail size
- [ ] One focal point, one message
- [ ] On-image text has a contrast backing so it's legible
- [ ] Hook + offer inside first 125 characters of ad copy
- [ ] Headline under ~30 characters
- [ ] CTA matches the actual action
- [ ] Important elements clear of Stories safe zones
- [ ] Previewed across all placements
