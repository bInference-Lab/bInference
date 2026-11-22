import type { AgentMode } from "./agent-motion";

/** Props of a slot: a place in a section where the agent stands while the section is on screen. */
export interface AgentSlotProps {
  /** The status pill's words while the agent stands here. */
  readonly label: string;
  readonly mode?: AgentMode;
  /** The `data-agent-target` of what the agent looks at here. */
  readonly look?: string;
  readonly className?: string | undefined;
}

/** Where the agent stands in a section; it keeps the mark's shape so the layout holds its place. */
export function AgentSlot(props: AgentSlotProps): React.JSX.Element {
  return (
    <div
      className={["slot", props.className].filter(Boolean).join(" ")}
      data-agent-slot=""
      data-mode={props.mode ?? "idle"}
      data-label={props.label}
      data-look={props.look}
      aria-hidden="true"
    />
  );
}
