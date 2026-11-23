"use client";

import { useState } from "react";
import styles from "./controls.module.css";

/** The words of the limits tile. */
export interface LimitWords {
  readonly title: string;
  readonly perTrade: string;
  readonly perDay: string;
  readonly drag: string;
  readonly tighter: string;
  readonly looser: string;
  /** Said after a looser value: when it takes effect. */
  readonly later: string;
}

type LimitName = "trade" | "day";
type Change = "none" | "tighter" | "looser";

interface Limit {
  readonly name: LimitName;
  readonly start: number;
  readonly max: number;
  readonly step: number;
}

// The limits `binference init` sets unless the owner types others, in US dollars.
const limits: readonly Limit[] = [
  { name: "trade", start: 100, max: 1000, step: 10 },
  { name: "day", start: 500, max: 5000, step: 50 },
];

const dollars = (value: number): string => `$${value.toLocaleString("en-US")}`;

function changeOf(limit: Limit, value: number): Change {
  if (value === limit.start) {
    return "none";
  }
  return value < limit.start ? "tighter" : "looser";
}

function Slider(props: {
  readonly limit: Limit;
  readonly label: string;
  readonly value: number;
  readonly later: string;
  readonly onMove: (value: number) => void;
}): React.JSX.Element {
  const { limit, value } = props;
  const looser = value > limit.start;
  return (
    <div className={styles["limit"]}>
      <span className={styles["limitHead"]}>
        <span>{props.label}</span>
        <output className={looser ? styles["later"] : undefined}>
          {looser ? `${dollars(limit.start)} · ${dollars(value)} ${props.later}` : dollars(value)}
        </output>
      </span>
      <input
        type="range"
        aria-label={props.label}
        min={limit.step}
        max={limit.max}
        step={limit.step}
        value={value}
        style={{ "--fill": `${String((value / limit.max) * 100)}%` }}
        onChange={(event) => {
          props.onMove(Number(event.currentTarget.value));
        }}
      />
    </div>
  );
}

/**
 * The two caps as sliders: a tighter cap applies at once, a looser one waits 24 hours with a
 * notice, as the engine treats them.
 */
export function LimitTile(props: { readonly words: LimitWords }): React.JSX.Element {
  const { words } = props;
  const [values, setValues] = useState<Readonly<Record<LimitName, number>>>({
    trade: 100,
    day: 500,
  });
  const [change, setChange] = useState<Change>("none");
  const labels: Readonly<Record<LimitName, string>> = { trade: words.perTrade, day: words.perDay };
  const said: Readonly<Record<Change, string>> = {
    none: words.drag,
    tighter: words.tighter,
    looser: words.looser,
  };
  return (
    <div className={`${styles["tile"] ?? ""} ${styles["limits"] ?? ""}`}>
      <h3>{words.title}</h3>
      {limits.map((limit) => (
        <Slider
          key={limit.name}
          limit={limit}
          label={labels[limit.name]}
          value={values[limit.name]}
          later={words.later}
          onMove={(value) => {
            setValues((now) => ({ ...now, [limit.name]: value }));
            setChange(changeOf(limit, value));
          }}
        />
      ))}
      <p className={styles["said"]} data-change={change} aria-live="polite">
        <i />
        {said[change]}
      </p>
    </div>
  );
}
