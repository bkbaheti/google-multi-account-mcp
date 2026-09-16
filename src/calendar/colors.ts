/**
 * Event colours.
 *
 * Google's `colors.get` returns ids and hex pairs and nothing else — the names people
 * actually see in the Calendar UI ("Tomato", "Basil") appear nowhere in the API. A caller
 * asked to make something red has a name, not an id, so the mapping lives here.
 *
 * The names are UI labels, not API data: they are maintained here, cross-checked against
 * the hex values Google returns (11 is #dc2127, a red; 10 is #51b749, a green). The palette
 * itself reports `updated: 2012-02-14`, so the pairing is as stable as anything in this API.
 *
 * Event colours and calendar colours are separate palettes with different ids for the same
 * name — Tomato is event 11 but calendar 3 — so this map is deliberately event-only.
 */
export const EVENT_COLOR_NAMES: Record<string, string> = {
  '1': 'Lavender',
  '2': 'Sage',
  '3': 'Grape',
  '4': 'Flamingo',
  '5': 'Banana',
  '6': 'Tangerine',
  '7': 'Peacock',
  '8': 'Graphite',
  '9': 'Blueberry',
  '10': 'Basil',
  '11': 'Tomato',
};

const NAME_TO_ID: Map<string, string> = new Map(
  Object.entries(EVENT_COLOR_NAMES).map(([id, name]) => [name.toLowerCase(), id]),
);

/** Google rejects anything outside 1-11 with a bare "Invalid color id value." 400. */
const EVENT_COLOR_ID_PATTERN = /^(?:[1-9]|1[01])$/;

/**
 * Resolves a colour id or a Calendar UI colour name to the id Google expects.
 *
 * Validated here rather than at the API: Google's own error says only "Invalid color id
 * value.", naming neither the valid range nor the fact that names exist at all.
 */
export function resolveEventColorId(input: string): string {
  const trimmed = input.trim();

  if (EVENT_COLOR_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const byName = NAME_TO_ID.get(trimmed.toLowerCase());
  if (byName) {
    return byName;
  }

  const names = Object.entries(EVENT_COLOR_NAMES)
    .map(([id, name]) => `${name} (${id})`)
    .join(', ');

  return failInvalidColor(input, names);
}

function failInvalidColor(input: string, names: string): never {
  throw new Error(
    `Invalid event color: "${input}". Use an id 1-11 or a Calendar colour name: ${names}.`,
  );
}
