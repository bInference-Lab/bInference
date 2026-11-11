import type { ProtocolId } from "@binference/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SquareIcon } from "lucide-react";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { useEngine } from "../connection/engine-context";
import { errorWords } from "../connection/error-words";
import { FailedAlert } from "../connection/failed-alert";
import { MessageText, useText } from "../i18n/console-text";
import { AgentQuestionCard } from "./agent-question";
import { ChatCards } from "./chat-cards";
import { ChatComposer } from "./chat-composer";
import { chatEntries } from "./chat-entries";
import { ChatThread, WorkingLine } from "./chat-thread";
import type { PickedImage } from "./composer-images";
import { CredentialRequestCard } from "./credential-request-card";
import { GoalPanel } from "./goal-panel";
import { LaunchDraftCard } from "./launch-draft-card";
import { NewChatButton } from "./new-chat-button";
import { ShellRequestCard } from "./shell-request-card";
import { uploadImage } from "./upload-image";
import { useChatLive } from "./use-chat-live";
import { transcriptKey, useTranscript } from "./use-transcript";

// Writes wait at most this long for the engine; a message's images upload within the same time.
const writeTimeoutMs = 60_000;

function writeCall(): { readonly signal: AbortSignal } {
  return { signal: AbortSignal.timeout(writeTimeoutMs) };
}

/** A message the owner sends: its text and the images to upload with it. */
interface Message {
  readonly text: string;
  readonly images: readonly PickedImage[];
}

/**
 * A stop the owner pressed: the chat's Stop the agent, which says what it stopped, or the
 * composer's Stop of the running answer, whose turn says it stopped.
 */
interface StopPress {
  readonly from: "top" | "composer";
  readonly wasAnswering: boolean;
}

function useChatActions(agent: ProtocolId<"agent">, live: ReturnType<typeof useChatLive>) {
  const { client, fetch } = useEngine();
  const queries = useQueryClient();
  const send = useMutation({
    mutationFn: async ({ text, images }: Message) => {
      const at = Date.now();
      const { signal } = writeCall();
      const uploads = await Promise.all(
        images.map(async (image) =>
          uploadImage(
            { client, fetch },
            { body: image.file, contentType: image.contentType },
            signal,
          ),
        ),
      );
      const args = { agent, text, ...(uploads.length === 0 ? {} : { images: uploads }) };
      const { turn } = await client.call("chat/post", args, { signal });
      live.sent({ kind: "owner", id: `owner ${turn}`, turn, text, images: uploads.length, at });
    },
  });
  const stop = useMutation({
    mutationFn: async (_press: StopPress) => client.call("chat/stop", { agent }, writeCall()),
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

type ChatActions = ReturnType<typeof useChatActions>;

// What the chat's Stop the agent says it stopped: the answer that ran or none, then the rest.
function StoppedLine(props: { readonly press: StopPress | undefined }): React.JSX.Element | null {
  const text = useText();
  if (props.press?.from !== "top") {
    return null;
  }
  const answer = props.press.wasAnswering ? "running" : "none";
  return (
    <output className="text-sm text-muted-foreground">
      {text("console.chat.stopped", { answer })}
    </output>
  );
}

// Stop the agent, reachable while it answers or not, so its helpers and commands end and its goal
// pauses (decisions 0403, 0407 and 0409); and New chat.
function ChatControls(props: {
  readonly actions: ChatActions;
  readonly canChat: boolean;
  readonly isRunning: boolean;
}): React.JSX.Element {
  const text = useText();
  const { stop, clear } = props.actions;
  return (
    <div className="flex flex-wrap items-start justify-end gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={!props.canChat || stop.isPending}
        onClick={() => stop.mutate({ from: "top", wasAnswering: props.isRunning })}
      >
        <SquareIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
        {text("console.chat.stopAgent")}
      </Button>
      <NewChatButton canStart={props.canChat && !clear.isPending} start={() => clear.mutate()} />
    </div>
  );
}

// The chat's controls, and what the chat says above the thread: what a stop stopped, that a new
// chat started, or that the chat so far could not load.
function ChatTop(props: {
  readonly actions: ChatActions;
  readonly canChat: boolean;
  readonly isRunning: boolean;
  readonly historyError: Error | null;
}): React.JSX.Element {
  const text = useText();
  const { stop, clear } = props.actions;
  return (
    <>
      <ChatControls actions={props.actions} canChat={props.canChat} isRunning={props.isRunning} />
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
      {stop.isSuccess ? <StoppedLine press={stop.variables} /> : null}
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
      <FailedAlert error={failed} wordsKey="console.chat.failed" />
      <ChatComposer
        actions={{
          send: async (said, images) => {
            await actions.send.mutateAsync({ text: said, images });
          },
          stop: () => actions.stop.mutate({ from: "composer", wasAnswering: true }),
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
 * The chat with one agent: its goal and progress note (decision 0407), the thread, the running
 * turn, the agent's question with its answer buttons, the agent's cards inline with Confirm and
 * Cancel, and the composer. Stop the agent stops it whether it answers or not, as Telegram's and
 * the terminal's `/stop` do. New chat asks once more, then starts a new session; the agent keeps
 * its notes and files.
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
      <ChatTop
        actions={actions}
        canChat={canChat}
        isRunning={running !== undefined}
        historyError={transcript.error}
      />
      <GoalPanel agent={agent} canChange={canChat} />
      <ChatThread
        entries={chatEntries(transcript.data ?? [], live.lines)}
        agent={agent}
        agentName={agentName}
      />
      {running === undefined ? null : (
        <WorkingLine draft={running.draft} startedAt={running.startedAt} />
      )}
      <AgentQuestionCard agent={agent} agentName={agentName} canAnswer={canChat} />
      <CredentialRequestCard agent={agent} agentName={agentName} canAnswer={canChat} />
      <ShellRequestCard
        agent={agent}
        agentName={agentName}
        canAnswer={ready.scopes.includes("confirm")}
      />
      <LaunchDraftCard agent={agent} agentName={agentName} />
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
