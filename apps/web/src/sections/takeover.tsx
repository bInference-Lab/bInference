"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { Scene } from "../motion/scene";
import styles from "./takeover.module.css";

/** One idea of the take-over: a short claim and its line. */
export interface Idea {
  readonly title: string;
  readonly line: string;
}

const layerClass: readonly string[] = ["l1", "l2", "l3"];

// Each color grows out of the full stop of the sentence before it, and each sentence scales
// around its own full stop, so the stop never moves while the screen changes behind it.
function placeOrigins(stage: HTMLElement): void {
  const box = stage.getBoundingClientRect();
  const layers = [...stage.querySelectorAll<HTMLElement>("[data-layer]")];
  layers.forEach((layer, index) => {
    const idea = layer.querySelector<HTMLElement>("[data-idea]");
    const stop = layer.querySelector("[data-stop]");
    if (idea === null || stop === null) {
      return;
    }
    const kept = idea.style.transform;
    idea.style.transform = "none";
    const dot = stop.getBoundingClientRect();
    const own = idea.getBoundingClientRect();
    idea.style.transform = kept;
    const x = dot.left + dot.width / 2;
    const y = dot.top + dot.height / 2;
    idea.style.transformOrigin = `${String(x - own.left)}px ${String(y - own.top)}px`;
    layers[index + 1]?.style.setProperty("--ox", `${String(x - box.left)}px`);
    layers[index + 1]?.style.setProperty("--oy", `${String(y - box.top)}px`);
  });
}

/** I read. I check. I ask: each full stop grows into the next full screen. */
export function Takeover(props: {
  readonly ideas: readonly [Idea, Idea, Idea];
}): React.JSX.Element {
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stage.current;
    if (el === null) {
      return undefined;
    }
    const place = (): void => placeOrigins(el);
    void document.fonts.ready.then(place);
    addEventListener("resize", place, { passive: true });
    return () => removeEventListener("resize", place);
  }, []);
  return (
    <Scene mode="pinned" className={styles["takeover"]}>
      <div ref={stage} className={styles["stage"]}>
        {props.ideas.map((idea, index): ReactNode => (
          <div
            key={idea.title}
            data-layer=""
            className={`${styles["layer"] ?? ""} ${styles[layerClass[index] ?? "l1"] ?? ""}`}
          >
            <div data-idea="" className={styles["idea"]}>
              <h2>
                {idea.title}
                <i data-stop="" />
              </h2>
              <p>{idea.line}</p>
            </div>
          </div>
        ))}
      </div>
    </Scene>
  );
}
