import { displayOutsideText } from "@binference/i18n";
import type { ProtocolId } from "@binference/protocol";
import { useQuery } from "@tanstack/react-query";
import { useEngine } from "../connection/engine-context";
import { useText } from "../i18n/console-text";
import type { MadeImage } from "./chat-entries";
import { type PictureParts, readPicture } from "./draft-picture";
import { usePictureAddress } from "./picture-address";

// One made image, read part by part with `image/read` once, shown from its bytes with its path.
function MadeImageItem(props: {
  readonly agent: ProtocolId<"agent">;
  readonly made: MadeImage;
}): React.JSX.Element {
  const text = useText();
  const { client } = useEngine();
  const { agent, made } = props;
  const picture = useQuery({
    queryKey: ["madeImage", agent, made.image],
    queryFn: async ({ signal }) => {
      const parts: PictureParts = async (offset, partSignal) =>
        client.call("image/read", { agent, image: made.image, offset }, { signal: partSignal });
      return readPicture(parts, made.bytes, signal);
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const address = usePictureAddress(picture.data ?? undefined);
  const path = displayOutsideText(made.path, Number.POSITIVE_INFINITY);
  return (
    <figure className="flex flex-col gap-1">
      {address === undefined ? null : (
        <img
          src={address}
          alt={text("console.chat.madeImage")}
          className="max-h-80 max-w-full rounded-md border object-contain"
        />
      )}
      {address === undefined && !picture.isPending ? (
        <p className="text-xs text-muted-foreground">{text("console.chat.madeImageMissing")}</p>
      ) : null}
      <figcaption className="break-all font-mono text-xs text-muted-foreground">{path}</figcaption>
    </figure>
  );
}

/**
 * The images the agent made (decision 0392), each drawn from the bytes the engine answers by its
 * id, never loaded from an address, with where it was saved in the agent's workspace.
 */
export function MadeImagesFigure(props: {
  readonly agent: ProtocolId<"agent">;
  readonly images: readonly MadeImage[];
}): React.JSX.Element {
  return (
    <div className="mr-auto flex max-w-[85%] flex-col gap-3">
      {props.images.map((made) => (
        <MadeImageItem key={made.image} agent={props.agent} made={made} />
      ))}
    </div>
  );
}
