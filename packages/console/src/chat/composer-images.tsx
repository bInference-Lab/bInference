import { maxImageBytes, maxImagesPerMessage } from "@binference/protocol";
import { ImagePlusIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { useText } from "../i18n/console-text";
import { type CheckedImage, type ImageRefusal, pickImages } from "./picked-images";

/** A file the owner added to the message, by an id of its own, with its preview's address. */
interface AddedFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly type: string;
  readonly file: File;
  /** An object URL of the file, revoked once the image leaves the message. */
  readonly url: string;
}

/** An image the message keeps, until it is sent or removed. */
export type PickedImage = CheckedImage<AddedFile>;

/** The images of the message being written, and what changes them. */
export interface ImagePicks {
  readonly images: readonly PickedImage[];
  readonly refused: readonly ImageRefusal[];
  readonly add: (files: readonly File[]) => void;
  readonly remove: (id: string) => void;
  readonly clear: () => void;
}

const accepted = "image/png,image/jpeg,image/webp";
const mib = maxImageBytes / (1024 * 1024);

function revoke(images: readonly { readonly url: string }[]): void {
  images.forEach((image) => URL.revokeObjectURL(image.url));
}

/**
 * Keeps the message's images, checked against the engine's limits as each one is added. Each
 * preview's object URL is revoked when its image leaves the message, and the rest when the
 * composer goes.
 */
export function useImagePicks(): ImagePicks {
  const [images, setImages] = useState<readonly PickedImage[]>([]);
  const [refused, setRefused] = useState<readonly ImageRefusal[]>([]);
  const next = useRef(0);
  const held = useRef<readonly PickedImage[]>([]);
  useEffect(() => {
    held.current = images;
  }, [images]);
  useEffect(() => () => revoke(held.current), []);
  const add = useCallback(
    (files: readonly File[]) => {
      const added = files.map((file): AddedFile => {
        next.current += 1;
        const { name, size, type } = file;
        const url = URL.createObjectURL(file);
        return { id: `image ${String(next.current)}`, name, size, type, file, url };
      });
      const picked = pickImages(images, added);
      const kept = new Set(picked.kept.map((image) => image.id));
      revoke(added.filter((file) => !kept.has(file.id)));
      setImages(picked.kept);
      setRefused(picked.refused);
    },
    [images],
  );
  const remove = useCallback((id: string) => {
    setImages((shown) => {
      revoke(shown.filter((image) => image.id === id));
      return shown.filter((image) => image.id !== id);
    });
    setRefused([]);
  }, []);
  const clear = useCallback(() => {
    setImages((shown) => {
      revoke(shown);
      return [];
    });
    setRefused([]);
  }, []);
  return { images, refused, add, remove, clear };
}

/** The image files a paste carries, such as a screenshot; its text pastes as usual. */
export function pastedImages(data: DataTransfer): readonly File[] {
  return [...data.files].filter((file) => file.type.startsWith("image/"));
}

function Preview(props: {
  readonly image: PickedImage;
  readonly number: number;
  readonly remove: () => void;
}): React.JSX.Element {
  const text = useText();
  return (
    <li className="relative">
      <img
        src={props.image.url}
        width={64}
        height={64}
        alt={text("console.chat.imageAlt", { number: props.number })}
        className="size-16 rounded-md border object-cover"
      />
      <Button
        type="button"
        variant="outline"
        size="icon-xs"
        className="absolute -top-2 -right-2 bg-background"
        aria-label={text("console.chat.removeImage", { number: props.number })}
        onClick={props.remove}
      >
        <XIcon aria-hidden strokeWidth={1.5} />
      </Button>
    </li>
  );
}

function refusalWords(text: ReturnType<typeof useText>, refusal: ImageRefusal): string {
  const { reason, name } = refusal;
  if (reason === "tooMany") {
    return text("console.chat.image.tooMany", { count: maxImagesPerMessage });
  }
  return reason === "tooLarge"
    ? text("console.chat.image.tooLarge", { name, mib })
    : text("console.chat.image.format", { name });
}

/** The message's images as small previews, each with Remove, and why any were left out. */
export function ImagePreviews(props: { readonly picks: ImagePicks }): React.JSX.Element | null {
  const text = useText();
  const { images, refused, remove } = props.picks;
  if (images.length === 0 && refused.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      {images.length === 0 ? null : (
        <ul
          className="flex flex-wrap gap-3 pt-2"
          aria-label={text("console.chat.images", { count: images.length })}
        >
          {images.map((image, at) => (
            <Preview key={image.id} image={image} number={at + 1} remove={() => remove(image.id)} />
          ))}
        </ul>
      )}
      {refused.length === 0 ? null : (
        <div role="alert" className="text-sm text-destructive">
          {refused.map((refusal) => (
            <p key={`${refusal.reason} ${refusal.name}`}>{refusalWords(text, refusal)}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/** Add image: opens the browser's file picker for PNG, JPEG and WebP images. */
export function AddImageButton(props: {
  readonly add: (files: readonly File[]) => void;
  readonly isDisabled: boolean;
}): React.JSX.Element {
  const text = useText();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={accepted}
        multiple
        hidden
        onChange={(event) => {
          const field = event.currentTarget;
          props.add([...(field.files ?? [])]);
          // The same file picked again is a new pick.
          field.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        disabled={props.isDisabled}
        onClick={() => input.current?.click()}
      >
        <ImagePlusIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
        {text("console.chat.addImage")}
      </Button>
    </>
  );
}
