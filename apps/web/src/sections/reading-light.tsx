"use client";

import { type ReactNode, useEffect, useRef } from "react";

interface Spot {
  readonly x: number;
  readonly y: number;
}

function followPointer(section: HTMLElement, lit: HTMLElement): () => void {
  let goal: Spot = { x: 0, y: 0 };
  let at: Spot = { x: 0, y: 0 };
  let frame = 0;
  const follow = (): void => {
    at = { x: at.x + (goal.x - at.x) * 0.12, y: at.y + (goal.y - at.y) * 0.12 };
    lit.style.setProperty("--sx", `${at.x.toFixed(1)}px`);
    lit.style.setProperty("--sy", `${at.y.toFixed(1)}px`);
    frame =
      Math.abs(goal.x - at.x) + Math.abs(goal.y - at.y) > 0.5 ? requestAnimationFrame(follow) : 0;
  };
  const move = (event: PointerEvent): void => {
    const box = section.getBoundingClientRect();
    goal = { x: event.clientX - box.left, y: event.clientY - box.top };
    if (lit.getAttribute("data-roam") !== "off") {
      lit.setAttribute("data-roam", "off");
      at = goal;
    }
    if (frame === 0) {
      frame = requestAnimationFrame(follow);
    }
  };
  section.addEventListener("pointermove", move, { passive: true });
  return () => {
    section.removeEventListener("pointermove", move);
    cancelAnimationFrame(frame);
  };
}

/** A section whose lit copy of the source follows the pointer; without one, the light roams. */
export function ReadingLight(props: {
  readonly className?: string | undefined;
  readonly id?: string;
  readonly children: ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const section = ref.current;
    const lit = section?.querySelector<HTMLElement>("[data-lit]");
    const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (
      section === null ||
      section === undefined ||
      lit === null ||
      lit === undefined ||
      !fine ||
      reduce
    ) {
      return undefined;
    }
    return followPointer(section, lit);
  }, []);
  return (
    <section ref={ref} className={props.className} id={props.id}>
      {props.children}
    </section>
  );
}
