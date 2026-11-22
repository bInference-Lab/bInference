"use client";

import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AgentBus } from "../agent/agent-bus";
import { useAgent } from "../agent/agent-context";
import styles from "./gate.module.css";

/** The gate's words. */
export interface GateWords {
  readonly label: string;
  readonly line: ReactNode;
  readonly nudge: string;
}

type Phase = "waiting" | "opening" | "gone";

const seenKey = "binference.web.awake";

function rememberAwake(): void {
  try {
    sessionStorage.setItem(seenKey, "1");
  } catch {
    // Storage may be off; the gate then shows again on the next visit.
  }
}

function wasAwake(): boolean {
  try {
    return sessionStorage.getItem(seenKey) === "1";
  } catch {
    return false;
  }
}

function openPage(bus: AgentBus): void {
  document.body.classList.remove("gated");
  document.body.classList.add("open");
  bus.wake();
}

function settle(bloom: RefObject<HTMLDivElement | null>, done: () => void): void {
  const { current: cover } = bloom;
  const slot = document.querySelector("[data-agent-slot]");
  if (cover === null || slot === null) {
    done();
    return;
  }
  const box = slot.getBoundingClientRect();
  const { style } = cover;
  style.display = "block";
  style.clipPath = "circle(150vmax at 50% 50%)";
  cover.addEventListener("transitionend", done, { once: true });
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      style.clipPath = `circle(0px at ${String(box.left + box.width / 2)}px ${String(box.top + box.height * 0.62)}px)`;
    }),
  );
}

interface GateParts {
  readonly phase: Phase;
  readonly open: () => void;
  readonly dot: RefObject<HTMLSpanElement | null>;
  readonly bloom: RefObject<HTMLDivElement | null>;
  readonly gate: RefObject<HTMLButtonElement | null>;
}

const noChange = (): (() => void) => () => undefined;

// A reader who woke the agent before, in this tab, finds it awake: the server renders the gate,
// and the first client render drops it.
function useGate(bus: AgentBus): GateParts {
  const seen = useSyncExternalStore(noChange, wasAwake, () => false);
  const [step, setStep] = useState<Phase>("waiting");
  const dot = useRef<HTMLSpanElement>(null);
  const bloom = useRef<HTMLDivElement>(null);
  const gate = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (seen) {
      openPage(bus);
    } else {
      gate.current?.focus();
    }
  }, [bus, seen]);
  const open = (): void => {
    if (step !== "waiting" || seen) {
      return;
    }
    bus.tap();
    rememberAwake();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      openPage(bus);
      setStep("gone");
      return;
    }
    setStep("opening");
    const cover = Math.ceil((Math.hypot(innerWidth, innerHeight) / 18) * 2.2);
    dot.current?.style.setProperty("transform", `scale(${String(cover)})`);
    setTimeout(() => {
      openPage(bus);
      settle(bloom, () => setStep("gone"));
    }, 900);
  };
  return { phase: seen ? "gone" : step, open, dot, bloom, gate };
}

/**
 * The page waits for a tap, as the agent does: one gold dot on ink. The tap grows the dot over
 * the screen, wakes the agent, and the gold settles into it.
 */
export function Gate(props: { readonly words: GateWords }): React.JSX.Element | null {
  const { phase, open, dot, bloom, gate } = useGate(useAgent());
  if (phase === "gone") {
    return null;
  }
  return (
    <>
      <button
        ref={gate}
        type="button"
        data-gate=""
        className={[styles["gate"], phase === "opening" ? styles["going"] : ""].join(" ")}
        aria-label={props.words.label}
        onClick={open}
      >
        <span ref={dot} className={styles["dot"]} />
        <span className={styles["line"]}>{props.words.line}</span>
        <span className={styles["nudge"]}>{props.words.nudge}</span>
      </button>
      <div ref={bloom} className={styles["bloom"]} />
    </>
  );
}
