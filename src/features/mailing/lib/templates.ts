// src/features/mailing/lib/templates.ts
// Template switching in the email editor: which fields the operator has made their
// own, and what each field becomes when a different preset is picked.

/** The parts of an email a template fills. */
export interface TemplateFields {
  name: string;
  subject: string;
  preheader: string;
  body: string;
}

/** A pickable template: a preset, or the blank starting point. */
export interface Template extends TemplateFields {
  id: string;
}

/** Dropdown id of the blank template. */
export const BLANK_TEMPLATE_ID = "blank";

/** What a new blank email starts with. Shared with the create route. */
export const BLANK_TEMPLATE: Template = {
  id: BLANK_TEMPLATE_ID,
  name: "Untitled email",
  subject: "",
  preheader: "",
  body: "Hi {firstName},\n\n",
};

const FIELDS = ["name", "subject", "preheader", "body"] as const;

/**
 * Compares two field values, ignoring trailing whitespace.
 * @param a - First value.
 * @param b - Second value.
 * @returns Whether they match.
 */
function same(a: string, b: string): boolean {
  return a.trimEnd() === b.trimEnd();
}

/**
 * True when a field still holds template text rather than the operator's own: it is
 * empty, matches the template it came from, or is the blank email's starter text.
 * Trailing whitespace is ignored so a stray newline doesn't make a field "edited".
 * @param value - Current field value.
 * @param fromValue - The same field in the template currently applied, if known.
 * @param blankValue - The same field in the blank template.
 * @returns Whether switching template may replace it.
 */
export function isUntouched(value: string, fromValue: string | null, blankValue: string): boolean {
  return (
    value.trim() === "" || (fromValue !== null && same(value, fromValue)) || same(value, blankValue)
  );
}

/**
 * Applies a different template, keeping every field the operator has made their own.
 * @param current - Fields as they are in the editor now.
 * @param from - Template currently applied, or null when it isn't known.
 * @param to - Template being switched to.
 * @returns The fields after the switch.
 */
export function switchTemplate(
  current: TemplateFields,
  from: TemplateFields | null,
  to: TemplateFields,
): TemplateFields {
  const next = { ...current };
  for (const key of FIELDS) {
    if (isUntouched(current[key], from ? from[key] : null, BLANK_TEMPLATE[key])) {
      next[key] = to[key];
    }
  }
  return next;
}

/**
 * Works out which template an existing draft was started from. The body is the
 * distinctive part, so a body match wins even when the subject has been edited; the
 * subject is the fallback for a draft whose body has been rewritten. Null when
 * neither matches, so nothing gets mistaken for template text.
 * @param current - The draft's fields.
 * @param templates - Templates to match against, blank included.
 * @returns The matching template's id, or null.
 */
export function matchTemplate(current: TemplateFields, templates: Template[]): string | null {
  const byBody = templates.find((t) => same(current.body, t.body));
  if (byBody) return byBody.id;
  const bySubject = current.subject.trim()
    ? templates.find((t) => same(current.subject, t.subject))
    : undefined;
  return bySubject?.id ?? null;
}
