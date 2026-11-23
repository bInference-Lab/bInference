/** A point in CSS pixels, relative to the board the threads are drawn on. */
export interface Spot {
  readonly x: number;
  readonly y: number;
}

/** A box in CSS pixels, relative to the same board. */
export interface Frame {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The middle of the box's edge that faces `from`, and the direction out of that edge. */
export function edgeFacing(box: Frame, from: Spot): { readonly at: Spot; readonly out: Spot } {
  const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  const dx = from.x - middle.x;
  const dy = from.y - middle.y;
  // Entered from the side whenever the core stands beside the box, else from the top or bottom.
  if (from.x < box.left || from.x > box.left + box.width) {
    const side = Math.sign(dx);
    return { at: { x: middle.x + (side * box.width) / 2, y: middle.y }, out: { x: side, y: 0 } };
  }
  const side = Math.sign(dy);
  return { at: { x: middle.x, y: middle.y + (side * box.height) / 2 }, out: { x: 0, y: side } };
}

const rounded = (value: number): string => value.toFixed(1);

/**
 * A thread from the agent's core to the box: it leaves the core's orbit at `reach` pixels toward
 * the box and curves into the middle of the edge that faces the core, as an SVG path.
 */
export function threadPath(core: Spot, reach: number, box: Frame): string {
  const { at, out } = edgeFacing(box, core);
  const dx = at.x - core.x;
  const dy = at.y - core.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const start = { x: core.x + (dx / length) * reach, y: core.y + (dy / length) * reach };
  const bend = Math.max(0, length - reach) * 0.45;
  const pull = { x: start.x + (dx / length) * bend, y: start.y + (dy / length) * bend };
  const ease = { x: at.x + out.x * bend, y: at.y + out.y * bend };
  return [
    `M${rounded(start.x)} ${rounded(start.y)}`,
    `C${rounded(pull.x)} ${rounded(pull.y)} ${rounded(ease.x)} ${rounded(ease.y)}`,
    `${rounded(at.x)} ${rounded(at.y)}`,
  ].join(" ");
}
