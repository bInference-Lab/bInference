import { cardLineText, reasonText } from "@binference/i18n";
import type { LaunchDraftView, ProtocolId } from "@binference/protocol";
import { CardLine, StatusIcon } from "../cards/card-line";
import { codeWords } from "../connection/error-words";
import { useFormatter, useText, type Words } from "../i18n/console-text";
import type { DraftPicture } from "./draft-picture";
import { usePictureAddress } from "./picture-address";
import { type EndedDraft, useLaunchDraft } from "./use-launch-draft";

/** The draft's last line: its words, and the status icon before them once it closed. */
interface LastLine {
  readonly text: string;
  readonly status?: "passed" | "refused";
}

// The line a draft that closed ends with: started, dropped, expired, replaced, or why it failed.
function endedLine(text: Words, reasonOf: (code: string) => string, ended: EndedDraft): LastLine {
  const { outcome, error, reason } = ended.closed;
  if (outcome !== "failed") {
    const status = outcome === "started" ? "passed" : "refused";
    return { text: text("console.draft.ended", { outcome }), status };
  }
  const said =
    reason === undefined
      ? text("console.draft.failed", { reason: codeWords(text, error) })
      : text("console.draft.endedBeforeCard", { reason: reasonOf(reason) });
  return { text: said, status: "refused" };
}

function DraftBody(props: {
  readonly view: LaunchDraftView;
  readonly agentName: string;
  readonly picture: DraftPicture | undefined;
  readonly last: LastLine;
}): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { view, agentName } = props;
  const address = usePictureAddress(props.picture);
  const display = { formatter, assets: view.assets };
  const header = text("console.draft.header", { agent: agentName });
  return (
    <section
      aria-label={header}
      className="mr-auto flex max-w-[85%] flex-col gap-2 rounded-lg border px-3 py-2 text-sm"
    >
      <p className="font-medium">{header}</p>
      {address === undefined ? null : (
        <img
          src={address}
          alt={text("console.draft.picture")}
          width={160}
          height={160}
          className="size-40 rounded-md border object-contain"
        />
      )}
      {view.lines.map((line) => {
        const drawn = cardLineText(line, display);
        return (
          <p key={drawn} className="break-words">
            <CardLine text={drawn} />
          </p>
        );
      })}
      <p className="text-muted-foreground">
        {props.last.status === undefined ? null : (
          <>
            <StatusIcon status={props.last.status} />{" "}
          </>
        )}
        {props.last.text}
      </p>
    </section>
  );
}

/**
 * The agent's launch draft below the chat, read-only (decision 0345): the header, the owner's
 * photo from its bytes, every line Telegram's message shows, and that the owner starts it in
 * Telegram, with when it ends. There is no Start and no Drop. Once it closes, its last line says
 * how it ended, until the next draft or a reload.
 */
export function LaunchDraftCard(props: {
  readonly agent: ProtocolId<"agent">;
  readonly agentName: string;
}): React.JSX.Element | null {
  const text = useText();
  const formatter = useFormatter();
  const { open, ended, picture } = useLaunchDraft(props.agent);
  const reasonOf = (code: string): string =>
    reasonText(formatter, code) ?? text("console.error.other");
  if (open !== undefined) {
    const time = formatter.time(open.expiresAt);
    const last = { text: text("console.draft.startInTelegram", { time }) };
    return <DraftBody view={open} agentName={props.agentName} picture={picture} last={last} />;
  }
  if (ended === undefined) {
    return null;
  }
  const last = endedLine(text, reasonOf, ended);
  return <DraftBody view={ended.view} agentName={props.agentName} picture={picture} last={last} />;
}
