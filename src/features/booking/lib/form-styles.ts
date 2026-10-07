// src/features/booking/lib/form-styles.ts
// Class strings for the public booking forms, so inputs, labels and choice chips change in one place.

/** Text input, select and textarea: 17px text, a solid border, and a teal focus outline. */
export const FIELD_INPUT =
  "w-full rounded-md border border-seasalt-300 bg-white px-3.5 py-3 text-[1.0625rem] text-rich-black focus:border-russian-violet focus:outline-3 focus:outline-offset-1 focus:outline-moonstone-500";

/** Field label above an input. */
export const FIELD_LABEL = "text-[1.0625rem] font-bold text-rich-black";

/** Secondary label inside a field group (address parts). */
export const FIELD_SUBLABEL = "text-base font-semibold text-rich-black";

/** Legend of a small fieldset inside a section (duration, day, time, meeting type). */
export const FIELD_LEGEND = "mb-2 text-[1.0625rem] font-bold text-rich-black";

/** Title of a form section ("Your details", "Describe the issue", "Schedule"). */
export const FORM_SECTION_TITLE = "mb-1 text-xl font-extrabold text-rich-black";

/** Every choice chip (duration, day, hour, minute, meeting type). */
export const CHOICE_BASE = "rounded-md border-2 font-bold transition-colors";
/** Chip not selected. */
export const CHOICE_IDLE =
  "border-seasalt-300 bg-white text-rich-black hover:border-russian-violet";
/** Chip selected: filled violet. */
export const CHOICE_ON = "border-russian-violet bg-russian-violet text-white";
/** Chip unavailable. */
export const CHOICE_OFF =
  "cursor-not-allowed border-seasalt-100 bg-seasalt text-seasalt-700 line-through";
