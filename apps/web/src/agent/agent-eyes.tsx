import { useId } from "react";
import type { EyeSide } from "./eye-pose";
import styles from "./agent-eyes.module.css";

/** Where each eye's center sits in the drawing, which is 102 by 30. */
export const eyeCenters: readonly number[] = [26, 76];

/** The drawing's width; the eyes' centers are read as shares of it on screen. */
export const eyesWidth = 102;

/** The upper lid's curve control when the eye is open: a full almond, the whole iris showing. */
export const openUpper = -14;

/** The lower lid's curve control when the eye is open. */
export const openLower = 12;

/** Where both lids meet when the eye is shut: a sleeper's curve, a little low. */
export const shutCurve = 3;

const corner = 20;
// Rounded, so the server and the browser write the same numbers into the page.
const fibers = Array.from({ length: 36 }, (_, step) => {
  const angle = (step * Math.PI) / 18;
  const at = (radius: number): string => (Math.cos(angle) * radius).toFixed(2);
  const up = (radius: number): string => (Math.sin(angle) * radius).toFixed(2);
  return { key: step, x1: at(3.9), y1: up(3.9), x2: at(8.5), y2: up(8.5) };
});

/** The opening between the two lids, from corner to corner, as an SVG path. */
export function openingPath(upper: number, lower: number): string {
  const [u, l] = [upper.toFixed(2), lower.toFixed(2)];
  return `M -${String(corner)} 0 C -10 ${u} 10 ${u} ${String(corner)} 0 C 10 ${l} -10 ${l} -${String(corner)} 0 Z`;
}

/** One lid's line from corner to corner, as an SVG path. */
export function lidPath(control: number): string {
  const c = control.toFixed(2);
  return `M -${String(corner)} 0 C -10 ${c} 10 ${c} ${String(corner)} 0`;
}

// The iris is engraved as the agent is: fine lines from the pupil to its rim.
function Iris(): React.JSX.Element {
  return (
    <g data-iris>
      <circle className={styles["iris"]} r={9} />
      {fibers.map((fiber) => (
        <line
          key={fiber.key}
          className={styles["fiber"]}
          x1={fiber.x1}
          y1={fiber.y1}
          x2={fiber.x2}
          y2={fiber.y2}
        />
      ))}
      <circle className={styles["limbus"]} r={8.6} />
      <circle data-pupil className={styles["pupil"]} r={3.6} />
      <circle className={styles["glint"]} cx={-2.6} cy={-2.9} r={1.5} />
      <circle className={styles["glint"]} cx={2.4} cy={2.1} r={0.6} />
    </g>
  );
}

function Eye(props: { readonly side: EyeSide; readonly x: number }): React.JSX.Element {
  const clip = `${useId()}-opening`;
  const outer = props.side === "left" ? -1 : 1;
  const wing = `M ${String(corner * outer)} 0 Q ${String(23 * outer)} -1.2 ${String(27 * outer)} -5.5`;
  return (
    <g transform={`translate(${String(props.x)} 15)`} data-eye={props.side}>
      <clipPath id={clip}>
        <path data-opening d={openingPath(shutCurve, shutCurve)} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect className={styles["white"]} x={-corner} y={-15} width={corner * 2} height={30} />
        <Iris />
      </g>
      <path data-lid="lower" className={styles["lower"]} d={lidPath(shutCurve)} />
      <path data-lid="upper" className={styles["upper"]} d={lidPath(shutCurve)} />
      <path className={styles["wing"]} d={wing} />
    </g>
  );
}

/**
 * The agent's eyes: two full almonds with an ivory white, an iris engraved in gold lines and a
 * gold lash that sweeps into a wing. They start shut; `runEyes` opens and moves them with the
 * agent and the reader's pointer.
 */
export function AgentEyes(): React.JSX.Element {
  return (
    <svg className={styles["eyes"]} viewBox={`0 0 ${String(eyesWidth)} 30`} aria-hidden="true">
      {eyeCenters.map((x, index) => (
        <Eye key={x} side={index === 0 ? "left" : "right"} x={x} />
      ))}
    </svg>
  );
}
