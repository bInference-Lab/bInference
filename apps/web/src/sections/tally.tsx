"use client";

import { useTaps } from "../agent/agent-context";
import styles from "./tally.module.css";

/** The tap counter: every tap counted, and the zero that matters. */
export function Tally(props: {
  readonly words: { readonly taps: string; readonly moved: string };
}): React.JSX.Element {
  const taps = useTaps();
  return (
    <div className={styles["tally"]} aria-live="polite">
      <span>
        {props.words.taps} <b>{taps}</b>
      </span>
      <span className={styles["zero"]}>
        {props.words.moved} <b>0</b>
      </span>
    </div>
  );
}
