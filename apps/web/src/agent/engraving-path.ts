import { markHeight, type Point } from "./mark-field";
import { linePeriod, type PathSink, traceRelief } from "./relief";

function at(x: number, y: number): string {
  return `${x.toFixed(1)} ${y.toFixed(1)}`;
}

function recorder(): { readonly sink: PathSink; readonly path: () => string } {
  const parts: string[] = [];
  return {
    sink: {
      moveTo: (x, y) => parts.push(`M${at(x, y)}`),
      lineTo: (x, y) => parts.push(`L${at(x, y)}`),
      closePath: () => parts.push("Z"),
    },
    path: () => parts.join(""),
  };
}

/**
 * The agent's engraving with its needle at `angle` as one SVG path in the mark's units, lit softly
 * from the upper left as the page draws an idle agent: every engraved line closed, to be filled
 * together.
 */
export function engravingPath(angle: number): string {
  const light = { x: -0.45, y: -0.5, z: 0.58 };
  const length = Math.hypot(light.x, light.y, light.z);
  const axis: Point = { x: Math.cos(angle), y: Math.sin(angle) };
  const { sink, path } = recorder();
  traceRelief(sink, {
    axis,
    light: { x: light.x / length, y: light.y / length, z: light.z / length },
    rows: Math.ceil(markHeight / linePeriod),
    weight: 1,
  });
  return path();
}
