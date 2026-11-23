import { restingAgent } from "./agent-motion";
import { engravingPath } from "./engraving-path";
import { corePoint, markOutline, sensorReach } from "./mark-field";

/** The drawing's frame in the mark's units: the mark with its orbit around the core. */
export const figureBox = { x: -80, y: -10, width: 620, height: 720 } as const;

const gold = "#f0b90b";
const orbit = 300;

function needle(angle: number): string {
  const arm = `<rect x="57" y="-10" width="60" height="20" rx="10"/><rect x="-117" y="-10" width="60" height="20" rx="10"/>`;
  const sensors = `<circle cx="${String(sensorReach)}" r="6"/><circle cx="${String(-sensorReach)}" r="6"/>`;
  const degrees = ((angle * 180) / Math.PI).toFixed(2);
  return `<g transform="rotate(${degrees})" fill="${gold}">${arm}${sensors}</g>`;
}

/**
 * The resting agent as a still SVG, drawn as the page draws it: the engraved mark lit from the
 * upper left, its outline, the needle with its sensors, the dial and the core, and one dotted orbit.
 * The shapes and proportions come from the same field and relief as the live agent.
 */
export function agentFigureSvg(): string {
  const { angle } = restingAgent({ x: 0, y: 0 });
  const box = `${String(figureBox.x)} ${String(figureBox.y)} ${String(figureBox.width)} ${String(figureBox.height)}`;
  const core = `transform="translate(${String(corePoint.x)} ${String(corePoint.y)})"`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">`,
    `<circle cx="${String(corePoint.x)}" cy="${String(corePoint.y)}" r="${String(orbit)}" fill="none" stroke="${gold}" stroke-opacity="0.4" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0.1 11"/>`,
    `<path d="${markOutline}" fill="none" stroke="${gold}" stroke-opacity="0.45" stroke-width="1.2"/>`,
    `<path d="${engravingPath(angle)}" fill="${gold}"/>`,
    `<g ${core}>`,
    needle(angle),
    `<circle r="47" fill="none" stroke="${gold}" stroke-opacity="0.55" stroke-width="1.4"/>`,
    `<circle r="38" fill="${gold}"/>`,
    `</g></svg>`,
  ].join("");
}
