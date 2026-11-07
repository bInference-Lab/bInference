import { displayOutsideText } from "@binference/i18n";
import type { ProtocolId, ResultOf } from "@binference/protocol";
import { useMutation } from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";
import { useText } from "../i18n/console-text";
import type { SentFile } from "./chat-entries";

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const text = atob(base64);
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

// One sent file, its bytes read part by part with `file/fetch` when the owner asks to save it.
function SentFileItem(props: {
  readonly agent: ProtocolId<"agent">;
  readonly sent: SentFile;
}): React.JSX.Element {
  const text = useText();
  const { client } = useEngine();
  const { agent, sent } = props;
  const save = useMutation({
    mutationFn: async () => {
      const pieces: Uint8Array<ArrayBuffer>[] = [];
      let offset: number | undefined = 0;
      while (offset !== undefined) {
        const args = { agent, file: sent.file, ...(offset === 0 ? {} : { offset }) };
        // oxlint-disable-next-line eslint/no-await-in-loop -- each part starts where the last ended
        const part: ResultOf<"file/fetch"> = await client.call("file/fetch", args, {
          signal: AbortSignal.timeout(30_000),
        });
        pieces.push(bytesOf(part.data));
        offset = part.next;
      }
      const address = URL.createObjectURL(new Blob(pieces));
      const link = document.createElement("a");
      link.href = address;
      link.download = sent.name;
      link.click();
      URL.revokeObjectURL(address);
    },
  });
  const name = displayOutsideText(sent.name, Number.POSITIVE_INFINITY);
  const path = displayOutsideText(sent.path, Number.POSITIVE_INFINITY);
  return (
    <li className="flex flex-col gap-1 rounded-md border px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="break-all text-sm font-medium">{name}</span>
        <button
          type="button"
          className="shrink-0 rounded-md border px-2 py-1 text-xs hover:bg-muted"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {text("console.chat.saveFile")}
        </button>
      </div>
      <span className="break-all font-mono text-xs text-muted-foreground">{path}</span>
      {save.isError ? (
        <span className="text-xs text-muted-foreground">{text("console.chat.fileMissing")}</span>
      ) : null}
    </li>
  );
}

/**
 * The files the agent sent (decision 0400): each by its name and path, saved on the owner's
 * device from the bytes the engine answers by its id, never from an address.
 */
export function SentFilesList(props: {
  readonly agent: ProtocolId<"agent">;
  readonly files: readonly SentFile[];
}): React.JSX.Element {
  return (
    <ul className="mr-auto flex max-w-[85%] flex-col gap-2">
      {props.files.map((sent) => (
        <SentFileItem key={sent.file} agent={props.agent} sent={sent} />
      ))}
    </ul>
  );
}
