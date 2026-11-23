"use client";

import { useEffect } from "react";
import { useAgent } from "./agent-context";

/**
 * Opens the page and wakes the agent on its first frame, so the mark draws itself in and the
 * first words rise as the page arrives. It draws nothing.
 */
export function Wake(): null {
  const bus = useAgent();
  useEffect(() => {
    // One frame after the first paint, so the closed state is drawn and the opening can move.
    const frame = requestAnimationFrame(() => {
      document.body.classList.add("open");
      bus.wake();
    });
    return () => cancelAnimationFrame(frame);
  }, [bus]);
  return null;
}
