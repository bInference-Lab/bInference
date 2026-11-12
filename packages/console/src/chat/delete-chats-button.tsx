import type { ProtocolId } from "@binference/protocol";
import { useMutation } from "@tanstack/react-query";
import { Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { useEngine } from "../connection/engine-context";
import { errorWords } from "../connection/error-words";
import { MessageText, useText } from "../i18n/console-text";

// A deletion stops a running answer first, then waits for the runtime's one write.
const deleteTimeoutMs = 60_000;

// The question asked once more, in words that name what goes, what stays and the backups.
function DeleteAsk(props: {
  readonly agentName: string;
  readonly onDelete: () => void;
  readonly onKeep: () => void;
}): React.JSX.Element {
  const text = useText();
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-wrap items-center justify-end gap-2 rounded-lg border px-3 py-2 text-sm"
    >
      <p id={id} className="mr-auto">
        {text("console.chats.deleteAsk", { name: props.agentName })}
      </p>
      <Button variant="outline" size="sm" onClick={props.onKeep}>
        {text("console.chats.keep")}
      </Button>
      <Button variant="destructive" size="sm" onClick={props.onDelete}>
        {text("console.chats.deleteConfirm")}
      </Button>
    </section>
  );
}

// What the deletion deleted, or why it did not.
function DeleteOutcome(props: {
  readonly deleted?: { readonly sessions: number; readonly events: number };
  readonly error: Error | null;
}): React.JSX.Element | null {
  const text = useText();
  const { deleted, error } = props;
  if (error !== null) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          <MessageText text={text("console.chats.failed", { reason: errorWords(text, error) })} />
        </AlertDescription>
      </Alert>
    );
  }
  return deleted === undefined ? null : (
    <output className="text-sm text-muted-foreground">
      {text("console.chats.deleted", { sessions: deleted.sessions, events: deleted.events })}
    </output>
  );
}

/**
 * Delete chats beside New chat (decision 0415), with `admin` only: asked once more in words that
 * name what goes, what stays and that backups still hold the chats, then `chat/delete` for the
 * agent, and what it deleted or why it did not. The chat itself clears on `chat/deleted`.
 */
export function DeleteChatsButton(props: {
  readonly agent: ProtocolId<"agent">;
  readonly agentName: string;
}): React.JSX.Element | null {
  const text = useText();
  const { client, ready } = useEngine();
  const { agent } = props;
  const [isAsking, ask] = useState(false);
  const remove = useMutation({
    mutationFn: async () =>
      client.call("chat/delete", { agent }, { signal: AbortSignal.timeout(deleteTimeoutMs) }),
  });
  if (!ready.scopes.includes("admin")) {
    return null;
  }
  const onDelete = (): void => {
    ask(false);
    remove.mutate();
  };
  return (
    <div className="flex flex-col items-end gap-2">
      {isAsking ? (
        <DeleteAsk agentName={props.agentName} onDelete={onDelete} onKeep={() => ask(false)} />
      ) : (
        <Button variant="outline" size="sm" disabled={remove.isPending} onClick={() => ask(true)}>
          <Trash2Icon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
          {text("console.chats.delete")}
        </Button>
      )}
      <DeleteOutcome
        {...(remove.data === undefined ? {} : { deleted: remove.data })}
        error={remove.error}
      />
    </div>
  );
}
