"use client";

import { useEffect, useRef } from "react";
import type { AgentBus, AgentOrder } from "./agent-bus";
import { useAgent } from "./agent-context";
import { AgentEyes } from "./agent-eyes";
import {
  type AgentMode,
  type AgentState,
  pulsedAgent,
  restingAgent,
  type SlotBox,
  stepAgent,
} from "./agent-motion";
import { type AgentPicture, drawAgent } from "./draw-agent";
import type { Point } from "./mark-field";
import { type EyesRun, runEyes } from "./run-eyes";
import styles from "./agent-stage.module.css";

/** The words of the status pill. */
export interface AgentStageWords {
  readonly agent: string;
  readonly asleep: string;
  readonly watching: string;
  /** The name of the eyes as a button: a poke makes the agent wink and pulse. */
  readonly poke: string;
}

const modes: readonly AgentMode[] = ["idle", "think", "wait", "clock", "frozen"];

function isAgentMode(value: string): value is AgentMode {
  return modes.some((mode) => mode === value);
}

interface Scene {
  readonly slot: SlotBox | undefined;
  readonly mode: AgentMode;
  readonly label: string | undefined;
  readonly target: Point | undefined;
  readonly clock: number;
}

function centerOf(el: Element): Point {
  const box = el.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

function nearestSlot(
  slots: readonly HTMLElement[],
): { readonly el: HTMLElement; readonly box: SlotBox } | undefined {
  let best: { readonly el: HTMLElement; readonly box: SlotBox } | undefined;
  let bestDistance = Infinity;
  slots.forEach((el, key) => {
    const box = el.getBoundingClientRect();
    const distance = Math.abs(box.top + box.height / 2 - innerHeight / 2);
    if (box.height > 0 && box.bottom > 0 && box.top < innerHeight && distance < bestDistance) {
      bestDistance = distance;
      best = {
        el,
        box: { key, x: box.left + box.width / 2, y: box.top + box.height / 2, height: box.height },
      };
    }
  });
  return best;
}

function modeOf(order: AgentOrder | undefined, slot: HTMLElement | undefined): AgentMode {
  if (order !== undefined) {
    return order.mode;
  }
  const mode = slot?.dataset["mode"] ?? "idle";
  return isAgentMode(mode) ? mode : "idle";
}

// What it looks at: what an order names, else what its slot names, else the pointer.
function targetOf(
  order: AgentOrder | undefined,
  slot: HTMLElement | undefined,
  pointer: Point | undefined,
): Point | undefined {
  const look = slot?.dataset["look"];
  const named = look === undefined ? null : document.querySelector(`[data-agent-target="${look}"]`);
  const target = order?.target ?? named;
  return target === null || target === undefined ? pointer : centerOf(target);
}

function sceneAt(bus: AgentBus, slots: readonly HTMLElement[], pointer: Point | undefined): Scene {
  const found = nearestSlot(slots);
  const order = bus.orderAt(performance.now());
  const clock = found === undefined ? "0" : getComputedStyle(found.el).getPropertyValue("--p");
  return {
    slot: found?.box,
    mode: modeOf(order, found?.el),
    label: order?.label ?? found?.el.dataset["label"],
    target: targetOf(order, found?.el, pointer),
    clock: Number(clock) || 0,
  };
}

/**
 * The agent: one canvas over the page that stands in the slot on screen, and its status pill,
 * whose eyes are the agent's own.
 */
export function AgentStage(props: { readonly words: AgentStageWords }): React.JSX.Element {
  const bus = useAgent();
  const canvas = useRef<HTMLCanvasElement>(null);
  const status = useRef<HTMLElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const poked = useRef(-1);
  useEffect(
    () => runAgent({ bus, canvas, status, pill, poked, words: props.words }),
    [bus, props.words],
  );
  const poke = (): void => {
    poked.current = performance.now() / 1000;
    bus.pulse();
  };
  return (
    <>
      <canvas ref={canvas} className={styles["canvas"]} aria-hidden="true" />
      <div ref={pill} className={styles["status"]}>
        <button
          type="button"
          className={styles["poke"]}
          aria-label={props.words.poke}
          onClick={poke}
        >
          <AgentEyes />
        </button>
        <span aria-live="polite">
          {props.words.agent} · <b ref={status}>{props.words.asleep}</b>
        </span>
      </div>
    </>
  );
}

interface Run {
  readonly bus: AgentBus;
  readonly canvas: { readonly current: HTMLCanvasElement | null };
  readonly status: { readonly current: HTMLElement | null };
  readonly pill: { readonly current: HTMLDivElement | null };
  readonly poked: { readonly current: number };
  readonly words: AgentStageWords;
}

// An order belongs to the section that gave it: once the agent moves on, it ends.
function orderKeeper(bus: AgentBus): (slot: number | undefined) => void {
  let last: number | undefined;
  return (slot) => {
    if (slot !== last && last !== undefined) {
      bus.order(undefined);
    }
    last = slot;
  };
}

interface PointerWatch {
  readonly at: () => Point | undefined;
  readonly stop: () => void;
}

// The agent follows a mouse or a pen; on a touch screen it lets its gaze wander instead.
function watchPointer(): PointerWatch {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) {
    return { at: () => undefined, stop: () => undefined };
  }
  let pointer: Point | undefined;
  const onPointer = (event: PointerEvent): void => {
    pointer = { x: event.clientX, y: event.clientY };
  };
  addEventListener("pointermove", onPointer, { passive: true });
  return { at: () => pointer, stop: () => removeEventListener("pointermove", onPointer) };
}

function startEyes(run: Run, pointer: PointerWatch): EyesRun | undefined {
  const pill = run.pill.current;
  const svg = pill?.querySelector("svg");
  if (pill === null || svg === null || svg === undefined) {
    return undefined;
  }
  return runEyes({ pill, svg, pointer: pointer.at, pokedAt: () => run.poked.current });
}

interface Senses {
  readonly pointer: PointerWatch;
  readonly eyes: EyesRun | undefined;
  readonly stop: () => void;
}

function watchSenses(run: Run): Senses {
  const pointer = watchPointer();
  const eyes = startEyes(run, pointer);
  return {
    pointer,
    eyes,
    stop: () => {
      pointer.stop();
      eyes?.stop();
    },
  };
}

function runAgent(run: Run): () => void {
  const el = run.canvas.current;
  const context = el?.getContext("2d");
  if (el === null || el === undefined || context === null || context === undefined) {
    return () => undefined;
  }
  const instant = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const slots = [...document.querySelectorAll<HTMLElement>("[data-agent-slot]")];
  const senses = watchSenses(run);
  const keepOrder = orderKeeper(run.bus);
  let state: AgentState = restingAgent({ x: innerWidth, y: innerHeight });
  let last = performance.now() / 1000;
  let shown = "";
  let frame = 0;
  const tick = (): void => {
    const now = performance.now() / 1000;
    const awake = run.bus.isAwake();
    const scene = sceneAt(run.bus, awake ? slots : [], senses.pointer.at());
    keepOrder(scene.slot?.key);
    state = stepAgent(run.bus.takePulse() ? pulsedAgent(state, now) : state, {
      now,
      elapsed: Math.min(0.05, now - last),
      slot: scene.slot,
      mode: scene.mode,
      target: scene.target,
      clock: scene.clock,
      awake,
      instant,
      chance: Math.random(),
    });
    last = now;
    senses.eyes?.draw({ state, now, awake });
    shown = showStatus(run, { awake, scene, shown, instant });
    paint(
      { canvas: el, context },
      {
        state,
        now,
        still: instant || scene.mode === "frozen",
        resting: scene.target === undefined,
      },
    );
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    senses.stop();
  };
}

interface StatusView {
  readonly awake: boolean;
  readonly scene: Scene;
  readonly shown: string;
  readonly instant: boolean;
}

// A new status rolls up into place from behind a soft blur.
const rising: readonly Keyframe[] = [
  { opacity: 0, transform: "translateY(70%)", filter: "blur(3px)" },
  { opacity: 1, transform: "none", filter: "none" },
];

function rollIn(label: HTMLElement, view: StatusView): void {
  if (!view.instant && view.shown !== "") {
    label.animate([...rising], { duration: 560, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
  }
}

function showStatus(run: Run, view: StatusView): string {
  const words = view.awake ? (view.scene.label ?? run.words.watching) : run.words.asleep;
  const { current: label } = run.status;
  if (words !== view.shown && label !== null) {
    label.textContent = words;
    rollIn(label, view);
    run.pill.current?.classList.toggle(styles["cold"] ?? "cold", view.scene.mode === "frozen");
    run.pill.current?.classList.toggle(styles["open"] ?? "open", view.awake);
  }
  return words;
}

interface Surface {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
}

function paint(surface: Surface, picture: AgentPicture): void {
  const { canvas, context } = surface;
  const pixelRatio = Math.min(2, devicePixelRatio || 1);
  const width = Math.round(canvas.clientWidth * pixelRatio);
  const height = Math.round(canvas.clientHeight * pixelRatio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  drawAgent(context, picture, pixelRatio);
}
