// src/features/business/lib/ai-input-copy.ts
// Shared copy for the "Describe the job" AI box, so the calculator and the invoice editor
// ask for the same details.

/** What to put in the description. */
export const JOB_DESCRIPTION_HINT =
  "Write what you did in plain words: how long you were there (or the times), what you worked on, any parts you supplied, and any parking or tolls you paid. Mention the suburb or address if you drove somewhere.";

/** Extra line shown when the job comes from a booking. */
export const JOB_DESCRIPTION_BOOKED_HINT =
  'The booking\'s times are used unless you write your own. Times on another day, like "Friday, 1:30-2pm", bill as a second visit on top.';

/** Worked example for the textarea. */
export const JOB_DESCRIPTION_PLACEHOLDER =
  "e.g. 10:00-12:00 at Dave's in Howick. Removed malware from his Windows laptop and set up his new router. Supplied an HDMI cable for $25 and paid $6 for parking.";

/** What to put in the description when pricing a job that hasn't happened yet. */
export const QUOTE_DESCRIPTION_HINT =
  "Write what the job will involve in plain words: the devices, what needs doing, and any parts you'll supply. Say where it will happen - the suburb or address, at home or remote - since that sets the rate and travel.";

/** Worked example for the textarea on a quote. */
export const QUOTE_DESCRIPTION_PLACEHOLDER =
  "e.g. At Mary's in Howick. Set up her new laptop and move her photos and email across from the old one. Supplying a 64 GB USB stick for $20.";
