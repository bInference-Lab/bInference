import type { ProtocolClient } from "@binference/client";
import { displayOutsideText } from "@binference/i18n";
import {
  type MediaContentType,
  type MediaPart,
  mediaTypeOf,
  maxVideoBytes,
  type ProtocolId,
} from "@binference/protocol";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useEngine } from "../connection/engine-context";
import { useText } from "../i18n/console-text";
import type { MadeMedia } from "./chat-entries";

/** A made medium as the console plays it: its bytes, and the type their first bytes name. */
interface MediaBytes {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly contentType: MediaContentType;
}

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const text = atob(base64);
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

/**
 * Reads a made medium part by part with `media/read`, and answers its bytes and the type their
 * first bytes name; none for one over 100 MiB, one whose size differs from `bytes`, or one of
 * another kind. The console never loads a medium from a URL.
 */
async function readMadeMedia(
  client: Pick<ProtocolClient, "call">,
  ask: { readonly agent: ProtocolId<"agent">; readonly made: MadeMedia },
  signal: AbortSignal,
): Promise<MediaBytes | null> {
  const { agent, made } = ask;
  if (made.bytes > maxVideoBytes) {
    return null;
  }
  const whole = new Uint8Array(made.bytes);
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const args = { agent, media: made.media, ...(offset === 0 ? {} : { offset }) };
    // oxlint-disable-next-line eslint/no-await-in-loop -- each part starts where the last ended
    const part: MediaPart = await client.call("media/read", args, { signal });
    const data = bytesOf(part.data);
    if (part.bytes !== made.bytes || part.offset + data.byteLength > made.bytes) {
      return null;
    }
    whole.set(data, part.offset);
    offset = part.next;
  }
  const contentType = mediaTypeOf(whole, made.kind);
  return contentType === undefined ? null : { bytes: whole, contentType };
}

// The medium as an address the page made from its bytes alone, let go when it changes or leaves.
function useMediaAddress(media: MediaBytes | undefined): string | undefined {
  const address = useMemo(
    () =>
      media === undefined
        ? undefined
        : URL.createObjectURL(new Blob([media.bytes], { type: media.contentType })),
    [media],
  );
  useEffect(
    () => () => {
      if (address !== undefined) {
        URL.revokeObjectURL(address);
      }
    },
    [address],
  );
  return address;
}

/**
 * A video the agent made, or its words spoken (decision 0405): played from the bytes the engine
 * answers by its id, never loaded from an address, with where it was saved in the workspace.
 */
export function MadeMediaPlayer(props: {
  readonly agent: ProtocolId<"agent">;
  readonly made: MadeMedia;
}): React.JSX.Element {
  const text = useText();
  const { client } = useEngine();
  const { agent, made } = props;
  const media = useQuery({
    queryKey: ["madeMedia", agent, made.media],
    queryFn: async ({ signal }) => readMadeMedia(client, { agent, made }, signal),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const address = useMediaAddress(media.data ?? undefined);
  const path = displayOutsideText(made.path, Number.POSITIVE_INFINITY);
  const isVideo = made.kind === "video";
  const label = text(isVideo ? "console.chat.madeVideo" : "console.chat.spoken");
  return (
    <figure className="mr-auto flex max-w-[85%] flex-col gap-1">
      {address !== undefined && isVideo ? (
        // oxlint-disable-next-line jsx-a11y/media-has-caption -- a model's video comes with no captions; the label and path name it
        <video
          src={address}
          controls
          aria-label={label}
          className="max-h-96 max-w-full rounded-md border"
        />
      ) : null}
      {address !== undefined && !isVideo ? (
        // oxlint-disable-next-line jsx-a11y/media-has-caption -- the agent's spoken words are the owner's ask for voice; the label names them
        <audio src={address} controls aria-label={label} />
      ) : null}
      {address === undefined && !media.isPending ? (
        <p className="text-xs text-muted-foreground">{text("console.chat.mediaMissing")}</p>
      ) : null}
      <figcaption className="break-all font-mono text-xs text-muted-foreground">{path}</figcaption>
    </figure>
  );
}
