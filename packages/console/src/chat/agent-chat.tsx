import type { ProtocolId } from "@binference/protocol";
import { Alert, AlertDescription } from "../components/ui/alert";
import { errorWords } from "../connection/error-words";
import { MessageText, useText } from "../i18n/console-text";
import { chatEntries } from "./chat-entries";
import { ChatThread } from "./chat-thread";
import { useTranscript } from "./use-transcript";

/** The chat with one agent: what the owner and the agent said in its open session. */
export function AgentChat(props: {
  readonly agent: ProtocolId<"agent">;
  readonly agentName: string;
}): React.JSX.Element {
  const { agent, agentName } = props;
  const text = useText();
  const transcript = useTranscript(agent);
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
      <ChatThread entries={chatEntries(transcript.data ?? [])} agentName={agentName} />
    </div>
  );
}
