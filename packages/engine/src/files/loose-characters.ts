// Code points a loose match reads as an apostrophe, a quote, a hyphen and a space.
const looseGroups: readonly (readonly [string, readonly number[]])[] = [
  ["'", [0x2018, 0x2019, 0x201a, 0x201b]],
  ['"', [0x201c, 0x201d, 0x201e, 0x201f]],
  ["-", [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212]],
  [
    " ",
    [
      0xa0, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f,
      0x3000,
    ],
  ],
];

const looseCharacters: ReadonlyMap<string, string> = new Map(
  looseGroups.flatMap(([plain, points]) =>
    points.map((point): [string, string] => [String.fromCodePoint(point), plain]),
  ),
);

/** A character as a loose match reads it: a curly quote, a dash or a special space as a plain one. */
export function foldCharacter(character: string): string {
  return looseCharacters.get(character) ?? character;
}

/** A text with every character folded as {@link foldCharacter} reads it. */
export function foldText(text: string): string {
  let folded = "";
  for (const character of text) {
    folded += foldCharacter(character);
  }
  return folded;
}
