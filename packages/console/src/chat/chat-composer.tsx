import { SendHorizontalIcon, SquareIcon } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useId, useState } from "react";
import { Button } from "../components/ui/button";
import { useText } from "../i18n/console-text";

/** What the composer hands the chat: the owner's text, and the actions it offers. */
export interface ComposerActions {
  /** Sends the text; resolves once the engine stored it, rejects with why it did not. */
  readonly send: (text: string) => Promise<void>;
  readonly stop: () => void;
}

/** Where the chat stands, for the composer's buttons. */
export interface ComposerState {
  readonly agentName: string;
  readonly isSending: boolean;
  readonly isRunning: boolean;
}

function ComposerButtons(props: {
  readonly canSend: boolean;
  readonly isRunning: boolean;
  readonly stop: () => void;
}): React.JSX.Element {
  const text = useText();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={!props.canSend}>
        <SendHorizontalIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
        {text("console.chat.post")}
      </Button>
      {props.isRunning ? (
        <Button type="button" variant="outline" onClick={props.stop}>
          <SquareIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
          {text("console.chat.stop")}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The box the owner writes to the agent in. Enter sends and Shift+Enter starts a new line, except
 * while an input method composes; Stop ends the agent's running turn.
 */
export function ChatComposer(props: {
  readonly actions: ComposerActions;
  readonly state: ComposerState;
}): React.JSX.Element {
  const text = useText();
  const id = useId();
  const [draft, setDraft] = useState("");
  const { actions, state } = props;
  const canSend = draft.trim() !== "" && !state.isSending;
  const submit = (): void => {
    if (canSend) {
      actions.send(draft.trim()).then(
        () => setDraft(""),
        () => undefined,
      );
    }
  };
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    submit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {text("console.chat.message")}
      </label>
      <textarea
        id={id}
        value={draft}
        rows={3}
        placeholder={text("console.chat.placeholder", { agent: state.agentName })}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        className="min-h-16 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <ComposerButtons canSend={canSend} isRunning={state.isRunning} stop={actions.stop} />
    </form>
  );
}
