/** The text every credential stand-in starts with. */
export const standInStart = "{{credential:";

// A whole stand-in: a credential's name as decision 0388 writes one, in capitals, digits and `_`.
const standIn = /\{\{credential:([A-Z][A-Z0-9_]{0,63})\}\}/gu;

/** The stand-ins a text holds. */
export interface StandIns {
  /** The credentials they name, each once, in the order they first appear. */
  readonly names: readonly string[];
  /** A `{{credential:` starts something that is not a whole stand-in. */
  readonly malformed: boolean;
}

// A credential's stand-in, as the agent writes it.
function standInOf(name: string): string {
  return `${standInStart}${name}}}`;
}

/** The stand-ins of a text, and whether one of its `{{credential:` starts none. */
export function standInsOf(text: string): StandIns {
  const names: string[] = [];
  for (const match of text.matchAll(standIn)) {
    names.push(match[1] ?? "");
  }
  const starts = text.split(standInStart).length - 1;
  return { names: [...new Set(names)], malformed: starts !== names.length };
}

/**
 * The text with each stand-in of a credential `values` holds replaced by its value, as `encode`
 * writes it; a stand-in of any other name is left as it is.
 */
export function withValues(
  text: string,
  values: ReadonlyMap<string, string>,
  encode: (value: string) => string = (value) => value,
): string {
  return text.replace(standIn, (whole: string, name: string) => {
    const value = values.get(name);
    return value === undefined ? whole : encode(value);
  });
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * The text with every value `values` holds, as it is and percent-encoded, replaced by its
 * credential's stand-in, in one pass, the longest form first, so a value inside another is never
 * left half shown.
 */
export function masked(text: string, values: ReadonlyMap<string, string>): string {
  const forms = new Map<string, string>();
  for (const [name, value] of values) {
    forms.set(value, name);
    forms.set(encodeURIComponent(value), name);
  }
  if (forms.size === 0) {
    return text;
  }
  const longestFirst = [...forms.keys()].toSorted((one, other) => other.length - one.length);
  const pattern = new RegExp(longestFirst.map(escaped).join("|"), "gu");
  return text.replace(pattern, (form: string) => standInOf(forms.get(form) ?? ""));
}
