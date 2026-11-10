// src/features/booking/lib/form-styles.ts
// Class strings for the public booking forms, so inputs, labels and choice chips change in one place.

/** Text input, select and textarea: 17px text, a solid border, and a teal focus outline. */
export const FIELD_INPUT =
  "w-full border border-seasalt-300 bg-white px-3.5 py-3 text-[1.0625rem] text-rich-black focus:border-russian-violet focus:outline-3 focus:outline-offset-1 focus:outline-moonstone-500";

/** Field label above an input. */
export const FIELD_LABEL = "text-[1.0625rem] font-bold text-rich-black";

/** Secondary label inside a field group (address parts). */
export const FIELD_SUBLABEL = "text-base font-semibold text-rich-black";

/** Legend of a small fieldset inside a section (duration, day, time, meeting type). */
export const FIELD_LEGEND = "mb-2 text-[1.0625rem] font-bold text-rich-black";

/** Title of a form section ("Your details", "Describe the issue", "Schedule"). */
export const FORM_SECTION_TITLE = "mb-1 text-xl font-extrabold text-rich-black";

/**
 * Every choice: chips (day, hour, minute, meeting type, name display) and the two-line cards
 * (appointment length, meeting place). Card text inherits the colour, so a card's description
 * turns white with it when selected.
 */
export const CHOICE_BASE = "border-2 font-bold transition-colors";
/** Chip not selected. */
export const CHOICE_IDLE =
  "border-seasalt-300 bg-white text-rich-black hover:border-russian-violet";
/** Chip selected: filled violet. */
export const CHOICE_ON = "border-russian-violet bg-russian-violet text-white";
/** Chip unavailable. */
export const CHOICE_OFF =
  "cursor-not-allowed border-seasalt-100 bg-seasalt text-seasalt-700 line-through";
/** Time already booked: stays in the grid, greyed, with "Booked" under the time. */
export const CHOICE_BOOKED = "cursor-not-allowed border-seasalt-200 bg-seasalt text-rich-black/60";
