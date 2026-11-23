"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { corePoint, markHeight, markWidth } from "../agent/mark-field";
import { type Frame, threadPath } from "./thread-path";
import styles from "./channels.module.css";

/** When each thread's pulses run, as points of the scene's progress; -1 for none. */
export interface ThreadTiming {
  readonly draw: number;
  readonly card: number;
  readonly back: number;
  readonly done: number;
}

interface Drawn {
  readonly width: number;
  readonly height: number;
  readonly paths: Readonly<Record<string, string>>;
}

const empty: Drawn = { width: 1, height: 1, paths: {} };

function frameOf(box: DOMRect, board: DOMRect): Frame {
  return {
    left: box.left - board.left,
    top: box.top - board.top,
    width: box.width,
    height: box.height,
  };
}

// Measures the layout, never a transform: the slot and the `data-thread` frames do not move.
function measure(board: HTMLElement): Drawn {
  const boardBox = board.getBoundingClientRect();
  const slot = board.querySelector("[data-agent-slot]")?.getBoundingClientRect();
  if (slot === undefined) {
    return empty;
  }
  const core = {
    x: slot.left - boardBox.left + (corePoint.x / markWidth) * slot.width,
    y: slot.top - boardBox.top + (corePoint.y / markHeight) * slot.height,
  };
  const reach = (330 / markHeight) * slot.height;
  const paths: Record<string, string> = {};
  for (const frame of board.querySelectorAll<HTMLElement>("[data-thread]")) {
    const name = frame.dataset["thread"] ?? "";
    paths[name] = threadPath(core, reach, frameOf(frame.getBoundingClientRect(), boardBox));
  }
  return { width: boardBox.width, height: boardBox.height, paths };
}

const pulse = (kind: string): string => `${styles["pulse"] ?? ""} ${styles[kind] ?? ""}`;

// Draws the threads again whenever the board, the drawing's parent, changes size.
function useDrawn(drawing: RefObject<SVGSVGElement | null>): Drawn {
  const [drawn, setDrawn] = useState(empty);
  useEffect(() => {
    const element = drawing.current?.parentElement;
    if (element === undefined || element === null) {
      return undefined;
    }
    const watch = new ResizeObserver(() => {
      setDrawn(measure(element));
    });
    watch.observe(element);
    return () => {
      watch.disconnect();
    };
  }, [drawing]);
  return drawn;
}

function ThreadLine(props: {
  readonly d: string;
  readonly timing: ThreadTiming;
}): React.JSX.Element {
  const { d, timing } = props;
  return (
    <g
      style={{
        "--draw": timing.draw,
        "--card": timing.card,
        "--back": timing.back,
        "--done": timing.done,
      }}
    >
      <path className={styles["thread"]} d={d} pathLength={1} />
      <path className={pulse("card")} d={d} pathLength={1} />
      <path className={pulse("back")} d={d} pathLength={1} />
      <path className={pulse("done")} d={d} pathLength={1} />
    </g>
  );
}

/**
 * The gold threads from the agent to every surface on its parent board, with the pulses that carry the
 * card out and the answer back. Their shapes follow the layout; their motion follows `--p`.
 */
export function ChannelThreads(props: {
  readonly timings: Readonly<Record<string, ThreadTiming>>;
}): React.JSX.Element {
  const drawing = useRef<SVGSVGElement>(null);
  const drawn = useDrawn(drawing);
  return (
    <svg
      ref={drawing}
      className={styles["threads"]}
      viewBox={`0 0 ${String(drawn.width)} ${String(drawn.height)}`}
      aria-hidden="true"
    >
      {Object.entries(drawn.paths).map(([name, d]) => {
        const timing = props.timings[name];
        return timing === undefined ? null : <ThreadLine key={name} d={d} timing={timing} />;
      })}
    </svg>
  );
}
