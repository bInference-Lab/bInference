import type { ReactNode } from "react";

/** One step the agent shows while it works, and the status pill's words for it. */
interface DemoStep {
  readonly text: string;
  readonly use: string;
}

/** The card a demo run ends at, waiting for the reader's tap. */
export interface DemoCard {
  readonly head: string;
  readonly action: string;
  readonly lines: readonly string[];
  readonly done: ReactNode;
}

/** One request the reader can pick, and what the agent does with it. */
export interface DemoRun {
  readonly id: string;
  readonly ask: string;
  readonly hint: string;
  readonly steps: readonly DemoStep[];
  /** The card it waits on; without one it ends on its own, frozen. */
  readonly card?: DemoCard;
  readonly frozen?: ReactNode;
}

/** A line in the demo's chat. */
export type DemoLine =
  | { readonly kind: "me"; readonly text: string }
  | { readonly kind: "step"; readonly text: string }
  | { readonly kind: "card"; readonly card: DemoCard; readonly answered: boolean }
  | { readonly kind: "waiting" }
  | { readonly kind: "result"; readonly tone: "ok" | "no" | "cold"; readonly body: ReactNode };

/** The pause before each line of a run, in milliseconds: the ask, each step, then the card. */
export const demoPace = { ask: 650, step: 680, card: 250 };

/** The chat after the reader answers the card: the card answered, the wait gone, the result. */
export function answered(lines: readonly DemoLine[], result: DemoLine): readonly DemoLine[] {
  return [
    ...lines
      .filter((line) => line.kind !== "waiting")
      .map((line): DemoLine =>
        line.kind === "card" ? { kind: "card", card: line.card, answered: true } : line,
      ),
    result,
  ];
}
