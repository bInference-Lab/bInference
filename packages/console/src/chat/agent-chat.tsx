import type { ProtocolId } from "@binference/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcwIcon } from "lucide-react";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { useEngine } from "../connection/engine-context";
import { errorWords } from "../connection/error-words";
import { MessageText, useText } from "../i18n/console-text";
import { ChatCards } from "./chat-cards";
import { ChatComposer } from "./chat-composer";
import { chatEntries } from "./chat-entries";
import { ChatThread, WorkingLine } from "./chat-thread";
import { useChatLive } from "./use-chat-live";
import { transcriptKey, useTranscript } from "./use-transcript";

// Writes wait at most this long for the engine; it stores a message in a few milliseconds.
const writeTimeoutMs = 30_000;

function writeCall(): { readonly signal: AbortSignal } {
  return { signal: AbortSignal.timeout(writeTimeoutMs) };
}

function useChatActions(agent: ProtocolId<"agent">, live: ReturnType<typeof useChatLive>) {
  const { client } = useEngine();
  const queries = useQueryClient();
  const send = useMutation({
    mutationFn: async (text: string) => {
      const at = Date.now();
      const { turn } = await client.call("chat/post", { agent, text }, writeCall());
      live.sent({ kind: "owner", id: `owner ${turn}`, turn, text, images: 0, at });
    },
  });
  const stop = useMutation({
    mutationFn: async () => client.call("chat/stop", { agent }, writeCall()),
  });
  const clear = useMutation({
    mutationFn: async () => client.call("chat/clear", { agent }, writeCall()),
    onSuccess: async () => {
      live.reset();
      await queries.invalidateQueries({ queryKey: transcriptKey(agent) });
    },
  });
  return { send, stop, clear };
}

function Failure(props: { readonly error: Error | null }): React.JSX.Element | null {
  const text = useText();
  if (props.error === null) {
    return null;
  }
  return (
    <Alert variant="destructive">
      <AlertDescription>
        <MessageText
          text={text("console.chat.failed", { reason: errorWords(text, props.error) })}
        />
      </AlertDescription>
    </Alert>
  );
}

type ChatActions = ReturnType<typeof useChatActions>;

// New chat, and what the chat says above the thread: that a new one started, or that the chat so
// far could not load.
function ChatTop(props: {
  readonly actions: ChatActions;
  readonly canChat: boolean;
  readonly historyError: Error | null;
}): React.JSX.Element {
  const text = useText();
  const { clear } = props.actions;
  return (
    <>
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          disabled={!props.canChat || clear.isPending}
          onClick={() => clear.mutate()}
        >
          <RotateCcwIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
          {text("console.chat.clear")}
        </Button>
      </div>
      {props.historyError === null ? null : (
        <Alert>
          <AlertDescription>
            <MessageText
              text={text("console.chat.historyFailed", {
                reason: errorWords(text, props.historyError),
              })}
            />
          </AlertDescription>
        </Alert>
      )}
      {clear.isSuccess ? (
        <output className="text-sm text-muted-foreground">{text("console.chat.cleared")}</output>
      ) : null}
    </>
  );
}

// What the owner writes with, or why this connection cannot.
function ChatBottom(props: {
  readonly actions: ChatActions;
  readonly canChat: boolean;
  readonly agentName: string;
  readonly isRunning: boolean;
}): React.JSX.Element {
  const text = useText();
  const { actions } = props;
  const failed = actions.send.error ?? actions.stop.error ?? actions.clear.error;
  if (!props.canChat) {
    return <p className="text-sm text-muted-foreground">{text("console.chat.noScope")}</p>;
  }
  return (
    <>
      <Failure error={failed} />
      <ChatComposer
        actions={{
          send: async (said) => {
            await actions.send.mutateAsync(said);
          },
          stop: () => actions.stop.mutate(),
        }}
        state={{
          agentName: props.agentName,
          isSending: actions.send.isPending,
          isRunning: props.isRunning,
        }}
      />
    </>
  );
}

/**
 * The chat with one agent: the thread, the running turn, the agent's cards inline with Confirm and
 * Cancel, and the composer. New chat starts a new session; the agent keeps its notes and files.
 */
export function AgentChat(props: {
  readonly agent: ProtocolId<"agent">;
  readonly agentName: string;
}): React.JSX.Element {
  const { agent, agentName } = props;
  const { ready } = useEngine();
  const transcript = useTranscript(agent);
  const live = useChatLive(agent);
  const actions = useChatActions(agent, live);
  const { running } = live;
  const canChat = ready.scopes.includes("chat");
  return (
    <div className="flex flex-col gap-4">
      <ChatTop actions={actions} canChat={canChat} historyError={transcript.error} />
      <ChatThread entries={chatEntries(transcript.data ?? [], live.lines)} agentName={agentName} />
      {running === undefined ? null : (
        <WorkingLine draft={running.draft} startedAt={running.startedAt} />
      )}
      <ChatCards agent={agent} />
      <ChatBottom
        actions={actions}
        canChat={canChat}
        agentName={agentName}
        isRunning={running !== undefined}
      />
    </div>
  );
}
