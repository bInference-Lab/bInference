"use client";

import { type ReactNode, useCallback, useRef } from "react";
import { AgentSlot } from "../agent/agent-slot";
import { Scene } from "../motion/scene";
import { clockText } from "./clock-text";
import styles from "./day.module.css";

/** One line of the example day's log. */
export interface DayEntry {
  readonly time: string;
  readonly text: string;
  /** When the line lights up, as the day's progress from 0 to 1. */
  readonly at: number;
}

/** The day scene's words. */
export interface DayWords {
  readonly title: ReactNode;
  readonly example: string;
  readonly label: string;
}

const ticks = Array.from({ length: 24 }, (_, hour) => {
  const angle = (hour / 24) * Math.PI * 2;
  const inner = hour % 6 === 0 ? 88 : 93;
  return {
    hour,
    x1: (100 + Math.sin(angle) * inner).toFixed(2),
    y1: (100 - Math.cos(angle) * inner).toFixed(2),
    x2: (100 + Math.sin(angle) * 98).toFixed(2),
    y2: (100 - Math.cos(angle) * 98).toFixed(2),
  };
});

/** A day with the agent: it stands in a clock, its needle the hour hand, its log filling in. */
export function Day(props: {
  readonly words: DayWords;
  readonly entries: readonly DayEntry[];
}): React.JSX.Element {
  const clock = useRef<HTMLSpanElement>(null);
  const onProgress = useCallback((p: number) => {
    if (clock.current !== null) {
      clock.current.textContent = clockText(p);
    }
  }, []);
  return (
    <Scene mode="pinned" className={styles["day"]} id="day" onProgress={onProgress}>
      <div className={`wide ${styles["stage"] ?? ""}`}>
        <div className={styles["dial"]}>
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <circle cx="100" cy="100" r="98" />
            <circle className={styles["arc"]} cx="100" cy="100" r="98" pathLength={1} />
            {ticks.map((tick) => (
              <line key={tick.hour} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} />
            ))}
          </svg>
          <AgentSlot className={styles["slot"]} mode="clock" label={props.words.label} />
          <span ref={clock} className={styles["clock"]}>
            00:00
          </span>
        </div>
        <div>
          <h2 className={`t-l thin ${styles["title"] ?? ""}`}>{props.words.title}</h2>
          <p className={styles["example"]}>{props.words.example}</p>
          {props.entries.map((entry) => (
            <div key={entry.time} className={styles["entry"]} style={{ "--a": entry.at }}>
              <time>{entry.time}</time>
              <p>{entry.text}</p>
            </div>
          ))}
        </div>
      </div>
    </Scene>
  );
}
