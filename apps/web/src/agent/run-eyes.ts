import { lidPath, openingPath, shutLid } from "./agent-eyes";
import type { AgentState } from "./agent-motion";
import { type EyePose, type EyeSide, eyePose } from "./eye-pose";
import type { Point } from "./mark-field";

/** What the eyes read besides the agent. */
export interface EyesSetup {
  /** The status pill: a pointer resting on it makes the eyes smile. */
  readonly pill: HTMLElement;
  readonly svg: SVGSVGElement;
  readonly pointer: () => Point | undefined;
  /** When the reader last poked the eyes, in seconds of `performance.now()`, or -1. */
  readonly pokedAt: () => number;
}

interface EyesFrame {
  readonly state: AgentState;
  readonly now: number;
  readonly awake: boolean;
}

/** The eyes as the agent's loop drives them. */
export interface EyesRun {
  /** Poses and draws both eyes for one frame of the agent. */
  readonly draw: (frame: EyesFrame) => void;
  readonly stop: () => void;
}

interface EyeParts {
  readonly side: EyeSide;
  readonly opening: SVGElement;
  readonly iris: SVGElement;
  readonly pupil: SVGElement;
  readonly upper: SVGElement;
  readonly lower: SVGElement;
}

/** How tall an open eye's lids curve, as their control height above and below the corners. */
const wide = 6.4;

function partsOf(group: SVGGElement): EyeParts | undefined {
  const side = group.dataset["eye"] === "right" ? "right" : "left";
  const find = (selector: string): SVGElement | null => group.querySelector<SVGElement>(selector);
  const [opening, iris, pupil, upper, lower] = [
    find("[data-opening]"),
    find("[data-iris]"),
    find("[data-pupil]"),
    find('[data-lid="upper"]'),
    find('[data-lid="lower"]'),
  ];
  if (opening === null || iris === null || pupil === null || upper === null || lower === null) {
    return undefined;
  }
  return { side, opening, iris, pupil, upper, lower };
}

function put(element: SVGElement, name: string, value: number | string): void {
  const text = typeof value === "number" ? value.toFixed(2) : value;
  if (element.getAttribute(name) !== text) {
    element.setAttribute(name, text);
  }
}

// The lids: the upper one follows the gaze up and down as a real lid does; a smile lifts the
// lower one into a crescent; shut, both meet in a sleeper's curve.
function lidsOf(pose: EyePose): { readonly upper: number; readonly lower: number } {
  const shut = 1 - pose.open;
  const upper = -wide + (wide + shutLid) * shut + pose.y * 0.9 * pose.open;
  const resting = wide - (wide - shutLid) * shut;
  const smiling = wide - (wide + 1.6) * pose.smile;
  return { upper, lower: Math.max(upper + 0.4, Math.min(resting, smiling)) };
}

// The iris slides toward what the eye looks at and narrows as it turns away, as a sphere would;
// its engraved lines stay level.
function drawEye(parts: EyeParts, pose: EyePose): void {
  const at = `${(pose.x * 3.6).toFixed(2)} ${(pose.y * 1.5).toFixed(2)}`;
  const narrow = `${(1 - Math.abs(pose.x) * 0.22).toFixed(2)} ${(1 - Math.abs(pose.y) * 0.12).toFixed(2)}`;
  put(parts.iris, "transform", `translate(${at}) scale(${narrow})`);
  put(parts.pupil, "r", 1.15 * pose.pupil);
  const lids = lidsOf(pose);
  put(parts.opening, "d", openingPath(lids.upper, lids.lower));
  put(parts.upper, "d", lidPath(lids.upper));
  put(parts.lower, "d", lidPath(lids.lower));
  put(parts.lower, "opacity", 0.55 * pose.open);
}

interface Layout {
  readonly box: DOMRect;
  readonly eyes: readonly Point[];
}

function measure(setup: EyesSetup): Layout {
  const box = setup.svg.getBoundingClientRect();
  const middle = box.top + box.height / 2;
  return {
    box: setup.pill.getBoundingClientRect(),
    eyes: [9, 29].map((x) => ({ x: box.left + (box.width * x) / 38, y: middle })),
  };
}

function inside(point: Point, box: DOMRect): boolean {
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}

function nearness(pointer: Point | undefined, box: DOMRect): number {
  if (pointer === undefined) {
    return 0;
  }
  const away = Math.hypot(pointer.x - (box.left + 24), pointer.y - (box.top + box.height / 2));
  return Math.min(1, Math.max(0, 1 - (away - 40) / 260));
}

// The reader counts as still until they move the pointer, scroll, tap or type.
function watchActivity(): { readonly since: () => number; readonly stop: () => void } {
  let last = performance.now() / 1000;
  const stir = (): void => {
    last = performance.now() / 1000;
  };
  const kinds = ["pointermove", "pointerdown", "scroll", "keydown"] as const;
  kinds.forEach((kind) => {
    addEventListener(kind, stir, { passive: true });
  });
  return {
    since: () => last,
    stop: () => {
      kinds.forEach((kind) => {
        removeEventListener(kind, stir);
      });
    },
  };
}

/** Drives the pill's eyes from the agent: call `draw` once a frame, `stop` when done. */
export function runEyes(setup: EyesSetup): EyesRun {
  const parts = [...setup.svg.querySelectorAll<SVGGElement>("[data-eye]")].flatMap(
    (group) => partsOf(group) ?? [],
  );
  let layout = measure(setup);
  const remeasure = (): void => {
    layout = measure(setup);
  };
  const resized = new ResizeObserver(remeasure);
  resized.observe(setup.pill);
  addEventListener("resize", remeasure, { passive: true });
  const activity = watchActivity();
  return {
    draw: (frame) => {
      const pointer = setup.pointer();
      const hover = pointer !== undefined && inside(pointer, layout.box) ? pointer : undefined;
      const shared = { ...frame, hover, pokedAt: setup.pokedAt() };
      const near = nearness(pointer, layout.box);
      parts.forEach((eye, index) => {
        const center = layout.eyes[index] ?? { x: 0, y: 0 };
        const still = frame.now - activity.since();
        drawEye(eye, eyePose({ ...shared, eye: center, side: eye.side, near, still }));
      });
    },
    stop: () => {
      resized.disconnect();
      removeEventListener("resize", remeasure);
      activity.stop();
    },
  };
}
