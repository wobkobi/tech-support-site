// scripts/check-areas.ts
// Guards the /areas helpers: stable region anchors, which suburbs get figures, and travel
// figures that match the invoice maths.
// Run with: npm test -- areas

import { commonSuburbs, regionSlug, travelFigure } from "@/features/areas/lib/areas";
import { expect, expectEqual, finish } from "./lib/harness.js";

/**
 * Runs every areas helper check, then exits non-zero on any failure.
 */
function main(): void {
  // Region anchors back deep links like /areas#east-auckland, so they must stay stable.
  expectEqual("slug: plain region", regionSlug("East Auckland"), "east-auckland");
  expectEqual("slug: macron folds", regionSlug("Māngere & Ōtāhuhu"), "mangere-otahuhu");
  expectEqual("slug: punctuation trimmed", regionSlug("  North Shore! "), "north-shore");
  expectEqual("slug: null region", regionSlug(null), "other-areas");
  expectEqual("slug: symbols only", regionSlug("---"), "other-areas");

  const group = { region: "West", suburbs: ["Henderson", "Te Atatū", "Glen Eden", "Kelston"] };
  expectEqual("common: first three in list order", commonSuburbs(group), [
    "Henderson",
    "Te Atatū",
    "Glen Eden",
  ]);
  expectEqual("common: custom count", commonSuburbs(group, 1), ["Henderson"]);
  expectEqual("common: short list", commonSuburbs({ region: null, suburbs: ["Avondale"] }), [
    "Avondale",
  ]);

  // $40/hr, $10 minimum: 62 min > $41.33 > rounds to $40; 20 min > $13.33 > $15.
  expectEqual("figure: Howick-ish", travelFigure(31, 31, 40, 10, 1), {
    eachWayMins: 31,
    full: 40,
    charged: 40,
  });
  expectEqual("figure: Mount Eden-ish", travelFigure(10, 10, 40, 10, 1), {
    eachWayMins: 10,
    full: 15,
    charged: 15,
  });
  expectEqual("figure: minimum applies", travelFigure(3, 3, 40, 10, 1), {
    eachWayMins: 3,
    full: 10,
    charged: 10,
  });
  // A slow return leg (bridge traffic) shows as the average, so minutes and price agree.
  expectEqual("figure: uneven legs", travelFigure(26, 40, 40, 10, 1), {
    eachWayMins: 33,
    full: 45,
    charged: 45,
  });
  expectEqual("figure: half-price promo", travelFigure(31, 31, 40, 10, 0.5), {
    eachWayMins: 31,
    full: 40,
    charged: 20,
  });
  expectEqual("figure: free travel promo", travelFigure(31, 31, 40, 10, 0), {
    eachWayMins: 31,
    full: 40,
    charged: 0,
  });
  expect("figure: unresolved address hidden", travelFigure(0, 0, 40, 10, 1) === null);

  finish();
}

main();
