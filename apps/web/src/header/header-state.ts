/** How the header sits: open across the hero, or gathered into a floating capsule below it. */
export type HeaderMode = "top" | "float";

/** Where the reader is on the page, in CSS pixels. */
export interface HeaderScroll {
  readonly y: number;
  /** Where the hero ends: past about half of it the header gathers into its capsule. */
  readonly heroEnd: number;
  /** How far the page scrolls in all. */
  readonly pageEnd: number;
}

/** What the header shows for one scroll position. */
export interface HeaderView {
  readonly mode: HeaderMode;
  /** The capsule slips away while the reader scrolls down past the hero, and returns on the way up. */
  readonly hidden: boolean;
  /** How far down the page the reader is, from 0 to 1. */
  readonly progress: number;
}

const settle = 6;

/** The header at `scroll`, given where it was a moment before. */
export function headerView(
  scroll: HeaderScroll,
  before: { readonly y: number; readonly hidden: boolean },
): HeaderView {
  const mode: HeaderMode = scroll.y > scroll.heroEnd * 0.55 ? "float" : "top";
  const moved = scroll.y - before.y;
  let hidden = before.hidden;
  if (mode === "top" || moved < -settle) {
    hidden = false;
  } else if (moved > settle && scroll.y > scroll.heroEnd) {
    hidden = true;
  }
  return {
    mode,
    hidden,
    progress: Math.min(1, Math.max(0, scroll.y / Math.max(1, scroll.pageEnd))),
  };
}

/**
 * The chapter the reader is in: the last one whose top has passed `line`, a height on the screen,
 * or -1 while every chapter is still below it.
 */
export function activeChapter(tops: readonly number[], line: number): number {
  return tops.reduce((active, top, index) => (top <= line ? index : active), -1);
}
