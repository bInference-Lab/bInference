"use client";

import { useEffect, useRef } from "react";
import { corePoint, markOutline, sensorReach } from "../agent/mark-field";
import styles from "./header-mark.module.css";

/** Props of the header's mark. */
export interface HeaderMarkProps {
  /** Grows each time the header changes shape, and the needle spins a half turn to mark it. */
  readonly turns: number;
}

const { x: cx, y: cy } = corePoint;

// The needle turns the short way toward the pointer; its two ends make a half turn a full one.
function turnToward(from: number, to: number): number {
  const difference = to - from;
  return from + Math.atan2(Math.sin(2 * difference), Math.cos(2 * difference)) / 2;
}

function useNeedle(turns: number): React.RefObject<SVGSVGElement | null> {
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = svg.current;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (el === null || reduce) {
      return undefined;
    }
    const groups = [...el.querySelectorAll<SVGGElement>("[data-needle]")];
    let goal = -0.5934 + turns * Math.PI;
    let angle = goal;
    let frame = 0;
    const draw = (): void => {
      angle += (goal - angle) * 0.12;
      for (const group of groups) {
        group.setAttribute(
          "transform",
          `rotate(${((angle * 180) / Math.PI).toFixed(2)} ${String(cx)} ${String(cy)})`,
        );
      }
      frame = Math.abs(goal - angle) > 0.002 ? requestAnimationFrame(draw) : 0;
    };
    const look = (event: PointerEvent): void => {
      const box = el.getBoundingClientRect();
      const core = { x: box.left + (cx / 480) * box.width, y: box.top + (cy / 644) * box.height };
      goal = turnToward(angle, Math.atan2(event.clientY - core.y, event.clientX - core.x));
      if (frame === 0) {
        frame = requestAnimationFrame(draw);
      }
    };
    frame = requestAnimationFrame(draw);
    addEventListener("pointermove", look, { passive: true });
    return () => {
      removeEventListener("pointermove", look);
      cancelAnimationFrame(frame);
    };
  }, [turns]);
  return svg;
}

/**
 * The agent in miniature: the mark engraved in gold lines, with the needle inside turning toward
 * the reader's pointer and a core that blinks now and then.
 */
export function HeaderMark(props: HeaderMarkProps): React.JSX.Element {
  const svg = useNeedle(props.turns);
  return (
    <svg ref={svg} className={styles["mark"]} viewBox="-8 -8 496 660" aria-hidden="true">
      <defs>
        <pattern id="header-lines" width="480" height="52" patternUnits="userSpaceOnUse">
          <rect width="480" height="24" />
        </pattern>
        <mask id="header-cut" maskUnits="userSpaceOnUse" x="-8" y="-8" width="496" height="660">
          <rect x="-8" y="-8" width="496" height="660" fill="#fff" />
          <circle cx={cx} cy={cy} r="127" fill="#000" />
          <g data-needle="">
            <circle cx={cx + sensorReach} cy={cy} r="40" fill="#000" />
            <circle cx={cx - sensorReach} cy={cy} r="40" fill="#000" />
            <rect
              x={cx - sensorReach}
              y={cy - 12}
              width={sensorReach * 2}
              height="24"
              fill="#000"
            />
          </g>
        </mask>
      </defs>
      <g className={styles["body"]} mask="url(#header-cut)">
        <path d={markOutline} fill="url(#header-lines)" />
      </g>
      <path className={styles["outline"]} d={markOutline} pathLength={1} />
      <g data-needle="" className={styles["needle"]}>
        <rect x={cx + 57} y={cy - 10} width="60" height="20" rx="10" />
        <rect x={cx - 117} y={cy - 10} width="60" height="20" rx="10" />
        <circle cx={cx + sensorReach} cy={cy} r="8" />
        <circle cx={cx - sensorReach} cy={cy} r="8" />
      </g>
      <circle className={styles["core"]} cx={cx} cy={cy} r="40" />
    </svg>
  );
}
