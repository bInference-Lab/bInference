// Control and format characters, lone surrogates and line and paragraph separators: what a reader
// of the registry renders unseen or out of order, such as U+202E, U+200B or a line break.
const hiddenText = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

/**
 * Whether text a registration file publishes for good holds a character a reader would not see
 * as written (decision 0335): a control or format character, a lone surrogate, or a line or
 * paragraph separator. The card shows such a character escaped, but a reader of the registry
 * renders it, so the engine refuses it before anything is stored.
 */
export function hasHiddenText(text: string): boolean {
  return hiddenText.test(text);
}
