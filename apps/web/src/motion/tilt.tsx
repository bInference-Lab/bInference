"use client";

import { type ReactNode, useEffect, useRef } from "react";

/** A block that tells its children where the pointer is, from -1 to 1, as `--mx` and `--my`. */
export function Tilt(props: {
  readonly className?: string | undefined;
  readonly children: ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (el === null || !fine || reduce) {
      return undefined;
    }
    let goal = { x: 0, y: 0 };
    let at = { x: 0, y: 0 };
    let frame = 0;
    const follow = (): void => {
      at = { x: at.x + (goal.x - at.x) * 0.08, y: at.y + (goal.y - at.y) * 0.08 };
      el.style.setProperty("--mx", at.x.toFixed(4));
      el.style.setProperty("--my", at.y.toFixed(4));
      frame =
        Math.abs(goal.x - at.x) + Math.abs(goal.y - at.y) > 0.001
          ? requestAnimationFrame(follow)
          : 0;
    };
    const move = (event: PointerEvent): void => {
      goal = { x: (event.clientX / innerWidth) * 2 - 1, y: (event.clientY / innerHeight) * 2 - 1 };
      if (frame === 0) {
        frame = requestAnimationFrame(follow);
      }
    };
    addEventListener("pointermove", move, { passive: true });
    return () => {
      removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div ref={ref} className={props.className}>
      {props.children}
    </div>
  );
}
