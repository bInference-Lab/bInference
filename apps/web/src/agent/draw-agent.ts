import type { AgentState } from "./agent-motion";
import { corePoint, markHeight, markOutline, markWidth, sensorReach } from "./mark-field";
import { linePeriod, traceRelief } from "./relief";

/** One frame of the agent to draw. Times are seconds. */
export interface AgentPicture {
  readonly state: AgentState;
  readonly now: number;
  /** Reduced motion or frozen: the agent does not breathe. */
  readonly still: boolean;
  /** Whether the agent is awake and not looking far: a soft light from the upper left then. */
  readonly resting: boolean;
}

interface Pen {
  readonly context: CanvasRenderingContext2D;
  readonly picture: AgentPicture;
  /** One CSS pixel in the mark's units, for hairlines. */
  readonly hair: number;
  /** Whether the agent is large enough for its fine ticks. */
  readonly detail: boolean;
  readonly breathe: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const easeOut = (value: number): number => 1 - (1 - value) ** 3;
const outline = typeof Path2D === "undefined" ? undefined : new Path2D(markOutline);

function colorOf(cold: number): string {
  const mix = (from: number, to: number): number => Math.round(from + (to - from) * cold);
  return `rgb(${mix(240, 143)} ${mix(185, 196)} ${mix(11, 255)})`;
}

interface Ticks {
  readonly radius: number;
  readonly count: number;
  readonly turn: number;
}

interface Polar {
  readonly angle: number;
  readonly radius: number;
}

function tickRing(pen: Pen, ticks: Ticks): void {
  const { context } = pen;
  const { radius, count, turn } = ticks;
  context.beginPath();
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * Math.PI * 2 + turn;
    const outer = radius + (index % 10 === 0 ? 16 : 8);
    context.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    context.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
  }
  context.stroke();
}

function dot(context: CanvasRenderingContext2D, at: Polar, size: number): void {
  const { angle, radius } = at;
  context.beginPath();
  context.arc(Math.cos(angle) * radius, Math.sin(angle) * radius, size, 0, Math.PI * 2);
  context.fill();
}

function drawThought(pen: Pen): void {
  const { context, picture } = pen;
  const { think, spin } = picture.state;
  context.globalAlpha = think;
  context.lineWidth = 3.2;
  context.beginPath();
  context.arc(0, 0, 300, picture.now * 4.2, picture.now * 4.2 + 0.95);
  context.stroke();
  for (let index = 0; index < 6; index++) {
    const travel = (picture.now * 0.9 + index / 6) % 1;
    context.globalAlpha = think * (1 - travel * 0.5);
    dot(context, { angle: index * 1.047 + spin * 2, radius: 300 - 240 * travel * travel }, 3.4);
  }
}

function drawPulse(pen: Pen): void {
  const { context, picture } = pen;
  const age = clamp01((picture.now - picture.state.pulseAt) / 1.3);
  if (picture.state.pulseAt < 0 || age >= 1) {
    return;
  }
  context.globalAlpha = 1 - age;
  context.lineWidth = 2.4;
  context.beginPath();
  context.arc(0, 0, 47 + 320 * easeOut(age), 0, Math.PI * 2);
  context.stroke();
}

// Orbit rings behind the mark drift against the look, which gives the figure depth.
function drawOrbits(pen: Pen): void {
  const { context, picture, hair } = pen;
  const { look, spin, wake } = picture.state;
  const grown = easeOut(clamp01(wake * 1.6));
  context.save();
  context.translate(corePoint.x - look.x * 9, corePoint.y - look.y * 9);
  context.lineWidth = hair;
  context.globalAlpha = 0.3 * grown;
  context.beginPath();
  context.arc(0, 0, 300 + pen.breathe * 1.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * grown);
  context.stroke();
  if (pen.detail) {
    context.globalAlpha = 0.34 * grown;
    tickRing(pen, { radius: 308, count: Math.round(120 * grown), turn: spin });
    context.globalAlpha = 0.17 * grown;
    context.setLineDash([2, 11]);
    context.beginPath();
    context.arc(0, 0, 352, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
  }
  context.globalAlpha = 0.9 * grown;
  dot(context, { angle: -spin * 1.7 + 1, radius: 300 }, 4.2);
  if (pen.detail) {
    dot(context, { angle: spin * 1.1 + 4, radius: 352 }, 3);
  }
  if (picture.state.think > 0.02) {
    drawThought(pen);
  }
  drawPulse(pen);
  context.restore();
}

// The light follows the look; an idle agent is lit softly from the upper left.
function drawBody(pen: Pen): void {
  const { context, picture, hair } = pen;
  const { look, angle, wake, cold } = picture.state;
  const lean = picture.resting ? { x: -0.45, y: -0.5 } : { x: 0, y: 0 };
  const lx = look.x * 0.9 + lean.x;
  const ly = look.y * 0.9 + lean.y;
  const length = Math.hypot(lx, ly, 0.58);
  context.globalAlpha = 1;
  context.beginPath();
  traceRelief(context, {
    axis: { x: Math.cos(angle), y: Math.sin(angle) },
    light: { x: lx / length, y: ly / length, z: 0.58 / length },
    rows: Math.floor((markHeight / linePeriod) * clamp01(wake * 1.5)),
    weight: 1 - cold * 0.35,
  });
  context.fill();
  if (outline !== undefined) {
    context.globalAlpha = 0.5 * clamp01(wake * 2 - 0.6);
    context.lineWidth = hair;
    context.stroke(outline);
  }
}

function drawNeedle(pen: Pen, grown: number): void {
  const { context, picture } = pen;
  const { angle, think } = picture.state;
  context.save();
  context.rotate(angle);
  context.beginPath();
  context.roundRect(57, -10, 60 * grown, 20, 10);
  context.roundRect(-57 - 60 * grown, -10, 60 * grown, 20, 10);
  context.fill();
  const sensor = 6 + think * (4 + Math.sin(picture.now * 9) * 3);
  context.beginPath();
  context.arc(sensorReach, 0, sensor, 0, Math.PI * 2);
  context.arc(-sensorReach, 0, sensor, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

// The instrument inside: dial, needle, sensors, core. Each layer moves a little more toward the
// look, so the eye reads depth without shading.
function drawInstrument(pen: Pen): void {
  const { context, picture, hair } = pen;
  const { look, wake, blinkAt, pulseAt } = picture.state;
  const grown = easeOut(clamp01(wake * 2 - 0.9));
  if (grown <= 0) {
    return;
  }
  context.save();
  context.translate(corePoint.x + look.x * 3, corePoint.y + look.y * 3);
  context.lineWidth = hair;
  if (pen.detail) {
    context.globalAlpha = 0.5 * grown;
    tickRing(pen, { radius: 99, count: 60, turn: 0 });
  }
  context.translate(look.x * 4, look.y * 4);
  context.globalAlpha = grown;
  drawNeedle(pen, grown);
  context.globalAlpha = 0.55 * grown;
  context.beginPath();
  context.arc(0, 0, 47, 0, Math.PI * 2);
  context.stroke();
  context.translate(look.x * 9, look.y * 9);
  context.globalAlpha = grown;
  const blink = blinkAt < 0 ? 0 : Math.sin(Math.PI * clamp01((picture.now - blinkAt) / 0.22));
  const swell = pulseAt < 0 ? 0 : Math.max(0, 0.25 - (picture.now - pulseAt));
  const core = 38 * grown * (1 + pen.breathe * 0.02 + swell);
  context.beginPath();
  context.ellipse(0, 0, core, core * (1 - blink * 0.9), 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function inkPen(pen: Pen): void {
  const { context } = pen;
  context.fillStyle = colorOf(pen.picture.state.cold);
  context.strokeStyle = context.fillStyle;
  context.lineCap = "round";
}

/** Draws the agent as a living engraving of the mark, at its place on a canvas of ratio `pixelRatio`. */
export function drawAgent(
  context: CanvasRenderingContext2D,
  picture: AgentPicture,
  pixelRatio: number,
): void {
  const { state } = picture;
  if (state.size <= 8 || state.wake <= 0) {
    return;
  }
  const scale = state.size / markHeight;
  const left = state.x - (markWidth / 2) * scale;
  const top = state.y - (markHeight / 2) * scale;
  context.setTransform(
    pixelRatio * scale,
    0,
    0,
    pixelRatio * scale,
    pixelRatio * left,
    pixelRatio * top,
  );
  const pen: Pen = {
    context,
    picture,
    hair: 1.1 / scale,
    detail: state.size > 150,
    breathe: picture.still ? 0 : Math.sin(picture.now * 1.5),
  };
  inkPen(pen);
  drawOrbits(pen);
  drawBody(pen);
  drawInstrument(pen);
}
