"use client";

import { type ReactNode, useEffect, useRef } from "react";
import type { SceneMode } from "./progress";
import { followScene } from "./scene-loop";

/** Props of a scene: a block whose children read its scroll progress as `--p`. */
export interface SceneProps {
  readonly mode: SceneMode;
  readonly steps?: number;
  readonly className?: string | undefined;
  readonly id?: string;
  readonly onProgress?: (p: number) => void;
  readonly children: ReactNode;
}

/** A section that tells its children how far the reader has scrolled through it. */
export function Scene(props: SceneProps): React.JSX.Element {
  const ref = useRef<HTMLElement>(null);
  const { mode, steps = 0, onProgress } = props;
  useEffect(() => {
    const el = ref.current;
    if (el === null) {
      return undefined;
    }
    return followScene(
      el,
      onProgress === undefined ? { mode, steps } : { mode, steps, onProgress },
    );
  }, [mode, steps, onProgress]);
  return (
    <section ref={ref} className={props.className} id={props.id}>
      {props.children}
    </section>
  );
}
