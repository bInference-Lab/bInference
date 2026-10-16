import type { ProtocolId } from "@binference/protocol";
import { Alert, AlertDescription } from "../components/ui/alert";
import { errorWords } from "../connection/error-words";
import { MessageText, useText } from "../i18n/console-text";
import { chatEntries } from "./chat-entries";
import { ChatThread, WorkingLine } from "./chat-thread";
import { useChatLive } from "./use-chat-live";
import { useTranscript } from "./use-transcript";

/**
 * The chat with one agent: what the owner and the agent said in its open session, then its
 * running turn as it happens, with the answer it writes so far and its status lines.
 */
export function AgentChat(props: {
  readonly agent: ProtocolId<"agent">;
  readonly agentName: string;
}): React.JSX.Element {
  const { agent, agentName } = props;
  const text = useText();
  const transcript = useTranscript(agent);
  const live = useChatLive(agent);
  const { running } = live;
  return (
    <div className="flex flex-col gap-4">
      {transcript.error === null ? null : (
        <Alert>
          <AlertDescription>
            <MessageText
              text={text("console.chat.historyFailed", {
                reason: errorWords(text, transcript.error),
              })}
            />
          </AlertDescription>
        </Alert>
      )}
      <ChatThread entries={chatEntries(transcript.data ?? [], live.lines)} agentName={agentName} />
      {running === undefined ? null : (
        <WorkingLine draft={running.draft} startedAt={running.startedAt} />
      )}
    </div>
  );
}
