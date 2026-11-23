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
import { useStepAside } from "./step-aside";
import { writingSeconds, writtenText } from "./written-text";
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
 * The agent: one canvas over the page that stands in the slot on screen, and in the corner its own
 * eyes, which follow the reader and read the status the agent writes beside them.
 */
export function AgentStage(props: { readonly words: AgentStageWords }): React.JSX.Element {
  const bus = useAgent();
  const canvas = useRef<HTMLCanvasElement>(null);
  const status = useRef<HTMLElement>(null);
  const live = useRef<HTMLSpanElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const poked = useRef(-1);
  const readUntil = useRef(0);
  useEffect(
    () => runAgent({ bus, canvas, status, live, pill, poked, readUntil, words: props.words }),
    [bus, props.words],
  );
  useStepAside(pill, styles["aside"] ?? "aside");
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
        <span className={styles["words"]} aria-hidden="true">
          <small>{props.words.agent}</small>
          <span className={styles["line"]}>
            <b ref={status} />
            <i className={styles["caret"]} />
          </span>
        </span>
        <span ref={live} className={styles["live"]} aria-live="polite">
          {props.words.asleep}
        </span>
      </div>
    </>
  );
}

interface Run {
  readonly bus: AgentBus;
  readonly canvas: { readonly current: HTMLCanvasElement | null };
  readonly status: { readonly current: HTMLElement | null };
  readonly live: { readonly current: HTMLElement | null };
  readonly pill: { readonly current: HTMLDivElement | null };
  readonly poked: { readonly current: number };
  /** Until when the eyes read the status, in seconds; the writer sets it as it begins. */
  readonly readUntil: { current: number };
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
  const { current: pill } = run.pill;
  const { current: words } = run.status;
  const svg = pill?.querySelector("svg");
  if (pill === null || words === null || svg === null || svg === undefined) {
    return undefined;
  }
  return runEyes({
    pill,
    svg,
    words,
    pointer: pointer.at,
    pokedAt: () => run.poked.current,
    readUntil: () => run.readUntil.current,
  });
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
  const write = createStatusWriter({ run, instant });
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
    write({ awake, scene, now });
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
  readonly now: number;
}

function setText(element: HTMLElement | null, text: string): void {
  if (element !== null && element.textContent !== text) {
    element.replaceChildren(text);
  }
}

// The agent writes each new status a letter at a time while its eyes read along; a screen
// reader hears the whole status at once from a copy no one sees.
function createStatusWriter(writer: {
  readonly run: Run;
  readonly instant: boolean;
}): (view: StatusView) => void {
  const { run, instant } = writer;
  const { readUntil } = run;
  let words = "";
  let since = 0;
  return (view) => {
    const next = view.awake ? (view.scene.label ?? run.words.watching) : run.words.asleep;
    if (next !== words) {
      words = next;
      since = view.now;
      readUntil.current = instant ? 0 : view.now + writingSeconds(next) + 0.6;
      setText(run.live.current, next);
      run.pill.current?.classList.toggle(styles["cold"] ?? "cold", view.scene.mode === "frozen");
      run.pill.current?.classList.toggle(styles["open"] ?? "open", view.awake);
    }
    setText(run.status.current, instant ? words : writtenText(words, view.now - since));
  };
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
