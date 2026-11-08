import { goalLines, progressNoteLines } from "@binference/i18n";
import type { GoalAction, GoalView, ProtocolId } from "@binference/protocol";
import { PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { useId } from "react";
import { Button } from "../components/ui/button";
import { errorWords } from "../connection/error-words";
import { useFormatter, useText } from "../i18n/console-text";
import { useGoal } from "./use-goal";

// The owner's changes a goal in each status takes; a complete goal only clears.
const moves: Readonly<Record<GoalView["status"], readonly GoalAction[]>> = {
  active: ["pause", "clear"],
  paused: ["resume", "clear"],
  blocked: ["pause", "resume", "clear"],
  complete: ["clear"],
};

const icons = { pause: PauseIcon, resume: PlayIcon, clear: XIcon } as const;

function GoalButtons(props: {
  readonly goal: GoalView;
  readonly canChange: boolean;
  readonly change: (action: GoalAction) => void;
}): React.JSX.Element {
  const text = useText();
  return (
    <div className="flex flex-wrap gap-2">
      {moves[props.goal.status].map((action) => {
        const Icon = icons[action];
        return (
          <Button
            key={action}
            variant="outline"
            size="sm"
            disabled={!props.canChange}
            onClick={() => props.change(action)}
          >
            <Icon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
            {text(`console.goal.${action}`)}
          </Button>
        );
      })}
    </div>
  );
}

function Lines(props: { readonly lines: readonly string[] }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 whitespace-pre-wrap text-sm">
      {props.lines.map((line, place) => (
        // oxlint-disable-next-line react/no-array-index-key -- lines repeat, and only their place tells them apart
        <p key={place}>{line}</p>
      ))}
    </div>
  );
}

/**
 * The open chat's goal and progress note beside the chat (decision 0407): the goal's status,
 * objective, goal turns and spend with Pause, Resume and Clear as its status allows, and the note
 * with its plan. A chat with neither shows nothing.
 */
export function GoalPanel(props: {
  readonly agent: ProtocolId<"agent">;
  readonly canChange: boolean;
}): React.JSX.Element | null {
  const text = useText();
  const formatter = useFormatter();
  const id = useId();
  const { read, change } = useGoal(props.agent);
  const { goal, note } = read;
  if (goal === undefined && note === undefined) {
    return null;
  }
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-lg border px-3 py-2">
      <h2 id={id} className="text-sm font-medium">
        {text("console.goal.title")}
      </h2>
      {goal === undefined ? null : <Lines lines={goalLines(goal, formatter).slice(0, -1)} />}
      {goal === undefined ? null : (
        <GoalButtons
          goal={goal}
          canChange={props.canChange && !change.isPending}
          change={(action) => change.mutate(action)}
        />
      )}
      {change.error === null ? null : (
        <p className="text-sm text-destructive">{errorWords(text, change.error)}</p>
      )}
      {note === undefined ? null : <Lines lines={progressNoteLines(note, formatter)} />}
    </section>
  );
}
