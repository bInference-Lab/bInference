// A text shorter than this, normalized, is too short to count as a repeat.
const leastRepeatChars = 10;
// One text inside the other is a repeat only when it is at least half of it.
const leastRepeatShare = 0.5;
// The most texts a turn remembers as shown; the oldest go first.
const mostShownTexts = 200;

/**
 * A text as the repeat check compares it: lowercase, without pictographs or Markdown marks, its
 * runs of space as one space, trimmed.
 */
function normalized(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/\p{Extended_Pictographic}/gu, "")
    .replaceAll(/[*_`~]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

// One of the two texts holds the other, and the shorter is at least half of the longer.
function isRepeatOf(text: string, shown: string): boolean {
  if (text.length < leastRepeatChars || shown.length < leastRepeatChars) {
    return false;
  }
  if (text.includes(shown)) {
    return shown.length >= text.length * leastRepeatShare;
  }
  return shown.includes(text) && text.length >= shown.length * leastRepeatShare;
}

/**
 * The agent's text with every paragraph that repeats what a tool already showed the owner in this
 * turn left out, such as an address a deposit message holds (decision 0381). A paragraph repeats a
 * shown text when, both normalized, one holds the other and the shorter is at least half of the
 * longer; a text under 10 characters never counts. The paragraphs kept keep their text and order.
 */
export function withoutShownText(text: string, shown: readonly string[]): string {
  const compared = shown.map(normalized);
  if (compared.length === 0) {
    return text;
  }
  const paragraphs = text.split(/\n[ \t]*\n/u);
  const kept = paragraphs.filter((paragraph) => {
    const own = normalized(paragraph);
    return !compared.some((each) => isRepeatOf(own, each));
  });
  return kept.length === paragraphs.length ? text : kept.join("\n\n").trim();
}

/** The texts a turn showed with one more set, the newest {@link mostShownTexts} kept. */
export function withShown(shown: readonly string[], more: readonly string[]): readonly string[] {
  return [...shown, ...more.filter((text) => text.trim() !== "")].slice(-mostShownTexts);
}
