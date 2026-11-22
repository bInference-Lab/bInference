/** A point or a direction in the mark's own units: 480 wide, 644 tall, y pointing down. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The mark's width and height in its own units. */
export const markWidth = 480;
/** The mark's height in its own units. */
export const markHeight = 644;
/** The center of the mark's ring, where the agent's core sits. */
export const corePoint: Point = { x: 230, y: 402 };
/** How far each sensor sits from the core, along the needle. */
export const sensorReach = 172;

/** The outline of the mark's body: the stem and the outer ring, for the hairline over it. */
export const markOutline =
  "M0 402L0 17.32A10 10 0 0 1 15 8.66L120 69.28A28 28 0 0 1 134 93.53L134 186.68A240 240 0 1 1 0 402Z";

function stemDistance(x: number, y: number): number {
  const bx = Math.abs(x - 67) - 67;
  const by = Math.abs(y - 215) - 196;
  const box = Math.hypot(Math.max(bx, 0), Math.max(by, 0)) + Math.min(Math.max(bx, by), 0);
  // The stem's top is cut on a slant, as in the mark.
  return Math.max(box, (x - 15) * 0.5 - (y - 8.66) * 0.866);
}

function needleCut(x: number, y: number, axis: Point): number {
  const fromX = x - (corePoint.x - axis.x * sensorReach);
  const fromY = y - (corePoint.y - axis.y * sensorReach);
  const spanX = axis.x * sensorReach * 2;
  const spanY = axis.y * sensorReach * 2;
  const along = Math.min(
    1,
    Math.max(0, (fromX * spanX + fromY * spanY) / (spanX ** 2 + spanY ** 2)),
  );
  return 10 - Math.hypot(fromX - spanX * along, fromY - spanY * along);
}

/**
 * The signed distance from (x, y) to the mark's body, negative inside: the stem and the ring,
 * with the core's hole and the needle's slot cut out along `axis`, a unit direction.
 */
export function bodyDistance(x: number, y: number, axis: Point): number {
  const ring = Math.hypot(x - 240, y - 402) - 240;
  let distance = Math.min(ring, stemDistance(x, y));
  distance = Math.max(distance, 127 - Math.hypot(x - corePoint.x, y - corePoint.y));
  const sensorX = axis.x * sensorReach;
  const sensorY = axis.y * sensorReach;
  distance = Math.max(
    distance,
    36 - Math.hypot(x - corePoint.x - sensorX, y - corePoint.y - sensorY),
    36 - Math.hypot(x - corePoint.x + sensorX, y - corePoint.y + sensorY),
  );
  return Math.max(distance, needleCut(x, y, axis));
}
