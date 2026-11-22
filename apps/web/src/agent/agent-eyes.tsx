import { useId } from "react";
import type { EyeSide } from "./eye-pose";
import styles from "./agent-eyes.module.css";

/** The control height of a lid's curve when the eye is shut: a sleeper's curve, a little low. */
export const shutLid = 1.4;

/** The opening of an eye between its two lids, from corner to corner, as an SVG path. */
export function openingPath(upper: number, lower: number): string {
  return `M -7 0 Q 0 ${upper.toFixed(2)} 7 0 Q 0 ${lower.toFixed(2)} -7 0 Z`;
}

/** One lid's line from corner to corner, as an SVG path. */
export function lidPath(control: number): string {
  return `M -7 0 Q 0 ${control.toFixed(2)} 7 0`;
}

interface EyeProps {
  readonly side: EyeSide;
  readonly x: number;
  /** The ids of the two engraved fills: the faint white of the eye and the bright iris. */
  readonly fills: { readonly white: string; readonly iris: string };
}

function Eye(props: EyeProps): React.JSX.Element {
  const clip = `${useId()}-opening`;
  return (
    <g transform={`translate(${String(props.x)} 7)`} data-eye={props.side}>
      <clipPath id={clip}>
        <path data-opening d={openingPath(shutLid, shutLid)} />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect x={-8} y={-5} width={16} height={10} fill={`url(#${props.fills.white})`} />
        <g data-iris>
          <circle r={3} fill={`url(#${props.fills.iris})`} />
          <circle className={styles["limbus"]} r={3} />
          <circle data-pupil className={styles["pupil"]} r={1.15} />
          <circle className={styles["glint"]} cx={-1} cy={-1.1} r={0.55} />
        </g>
      </g>
      <path data-lid="lower" className={styles["lower"]} d={lidPath(shutLid)} />
      <path data-lid="upper" className={styles["upper"]} d={lidPath(shutLid)} />
    </g>
  );
}

/**
 * The agent's eyes in the status pill, engraved as the agent itself is: gold lines on ink, an
 * iris of brighter lines, a gold lash for each upper lid. They start shut; `runEyes` opens and
 * moves them with the agent.
 */
export function AgentEyes(): React.JSX.Element {
  const id = useId();
  const fills = { white: `${id}-white`, iris: `${id}-iris` };
  return (
    <svg className={styles["eyes"]} viewBox="0 0 38 14" aria-hidden="true">
      <defs>
        <pattern id={fills.white} width={2} height={1.3} patternUnits="userSpaceOnUse">
          <rect className={styles["faint"]} width={2} height={0.55} />
        </pattern>
        <pattern id={fills.iris} width={2} height={1.3} patternUnits="userSpaceOnUse">
          <rect className={styles["bright"]} width={2} height={0.8} />
        </pattern>
      </defs>
      <Eye side="left" x={9} fills={fills} />
      <Eye side="right" x={29} fills={fills} />
    </svg>
  );
}
