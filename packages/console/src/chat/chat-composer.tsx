import { SendHorizontalIcon, SquareIcon } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useId, useState } from "react";
import { Button } from "../components/ui/button";
import { useText } from "../i18n/console-text";
import {
  AddImageButton,
  ImagePreviews,
  pastedImages,
  type PickedImage,
  useImagePicks,
} from "./composer-images";

/** What the composer hands the chat: the owner's message, and the actions it offers. */
export interface ComposerActions {
  /**
   * Sends the text and the images; resolves once the engine stored the message, rejects with why
   * it did not.
   */
  readonly send: (text: string, images: readonly PickedImage[]) => Promise<void>;
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
  readonly state: ComposerState;
  readonly stop: () => void;
  readonly add: (files: readonly File[]) => void;
}): React.JSX.Element {
  const text = useText();
  const { state } = props;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" disabled={!props.canSend} aria-busy={state.isSending}>
        <SendHorizontalIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
        {text("console.chat.post")}
      </Button>
      <AddImageButton add={props.add} isDisabled={state.isSending} />
      {state.isRunning ? (
        <Button type="button" variant="outline" onClick={props.stop}>
          <SquareIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
          {text("console.chat.stop")}
        </Button>
      ) : null}
    </div>
  );
}

// The message being written, and how the owner sends it.
function useComposer(actions: ComposerActions, state: ComposerState) {
  const [draft, setDraft] = useState("");
  const picks = useImagePicks();
  const canSend = (draft.trim() !== "" || picks.images.length > 0) && !state.isSending;
  const submit = (): void => {
    if (!canSend) {
      return;
    }
    actions.send(draft.trim(), picks.images).then(
      () => {
        setDraft("");
        picks.clear();
        return undefined;
      },
      // The chat shows why the message was not sent; the box keeps it to send again.
      () => undefined,
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };
  return { draft, setDraft, picks, canSend, submit, onKeyDown };
}

/**
 * The box the owner writes to the agent in, with the images to send. Enter sends and Shift+Enter
 * starts a new line, except while an input method composes; an image pasted into the box joins the
 * message; Stop ends the agent's running turn.
 */
export function ChatComposer(props: {
  readonly actions: ComposerActions;
  readonly state: ComposerState;
}): React.JSX.Element {
  const text = useText();
  const id = useId();
  const { actions, state } = props;
  const composer = useComposer(actions, state);
  const { picks } = composer;
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    composer.submit();
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {text("console.chat.message")}
      </label>
      <textarea
        id={id}
        value={composer.draft}
        rows={3}
        placeholder={text("console.chat.placeholder", { agent: state.agentName })}
        onChange={(event) => composer.setDraft(event.target.value)}
        onKeyDown={composer.onKeyDown}
        onPaste={(event) => picks.add(pastedImages(event.clipboardData))}
        className="min-h-16 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <ImagePreviews picks={picks} />
      <ComposerButtons
        canSend={composer.canSend}
        state={state}
        stop={actions.stop}
        add={picks.add}
      />
    </form>
  );
}
