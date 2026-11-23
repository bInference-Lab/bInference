"use client";

import { useState } from "react";
import styles from "./controls.module.css";

/** The words of the mode tile. */
export interface ModeWords {
  readonly title: string;
  readonly manual: string;
  readonly auto: string;
  readonly manualNote: string;
  readonly autoNote: string;
  readonly asks: string;
  readonly runs: string;
  /** Each example action, and whether auto mode runs it without a card. */
  readonly rows: readonly { readonly text: string; readonly runsInAuto: boolean }[];
}

type Mode = "manual" | "auto";

function Outcome(props: { readonly runs: boolean; readonly words: ModeWords }): React.JSX.Element {
  return props.runs ? (
    <span className={styles["runs"]}>
      <i />
      {props.words.runs}
    </span>
  ) : (
    <span className={styles["asks"]}>
      <i />
      {props.words.asks}
    </span>
  );
}

/**
 * Manual or auto mode, which the reader switches: each example action says whether it waits for
 * the owner's tap or runs and sends a receipt.
 */
export function ModeTile(props: { readonly words: ModeWords }): React.JSX.Element {
  const { words } = props;
  const [mode, setMode] = useState<Mode>("manual");
  const choices: readonly { readonly value: Mode; readonly label: string }[] = [
    { value: "manual", label: words.manual },
    { value: "auto", label: words.auto },
  ];
  return (
    <div className={`${styles["tile"] ?? ""} ${styles["mode"] ?? ""}`} data-mode={mode}>
      <div className={styles["tileHead"]}>
        <h3>{words.title}</h3>
        <fieldset className={styles["switch"]} aria-label={words.title}>
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={mode === choice.value}
              onClick={() => {
                setMode(choice.value);
              }}
            >
              {choice.label}
            </button>
          ))}
        </fieldset>
      </div>
      <p className={styles["note"]}>{mode === "manual" ? words.manualNote : words.autoNote}</p>
      <ul className={styles["rows"]}>
        {words.rows.map((row) => (
          <li key={row.text}>
            <span>{row.text}</span>
            <Outcome runs={mode === "auto" && row.runsInAuto} words={words} />
          </li>
        ))}
      </ul>
      <p className={styles["command"]}>binference approval {mode}</p>
    </div>
  );
}
