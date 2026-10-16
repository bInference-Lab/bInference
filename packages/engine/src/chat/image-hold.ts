import { err, ok, type Clock, type Result } from "@binference/core";
import type { ImageContentType } from "@binference/protocol";
import { imageTypeOf } from "./image-type.js";
import type { ImageRefusal, OwnerImageSource } from "./ports.js";

/** An image the hold read from its source, with its format by its first bytes. */
export interface HeldImage {
  readonly contentType: ImageContentType;
  readonly bytes: Readonly<Uint8Array>;
}

/** Why the hold has no image to give: the source's refusal, or a format the agent cannot read. */
export type HoldRefusal = ImageRefusal | "format";

/**
 * The owner's images the engine holds while the runtime reads them in parts (decision 0227): each
 * read once from its source, kept in memory until `drop` or for 2 minutes, at most 8 at once.
 */
export interface ImageHold {
  /**
   * The image under `key`, read from the source with `image` the first time and held after. A read
   * that fails is not held, so the next call reads again.
   */
  read(
    key: string,
    image: string,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<HeldImage, HoldRefusal>>;
  /** Lets the image under `key` go: its last part was read. */
  drop(key: string): void;
}

/** How long and how many images the hold keeps. */
export interface ImageHoldOptions {
  readonly source: OwnerImageSource;
  readonly clock: Clock;
  readonly keepMs?: number;
  readonly most?: number;
}

interface Entry {
  readonly image: HeldImage;
  readonly untilMs: number;
}

async function readOnce(
  source: OwnerImageSource,
  image: string,
  options: { readonly signal: AbortSignal },
): Promise<Result<HeldImage, HoldRefusal>> {
  const read = await source.read(image, options);
  if (!read.ok) {
    return read;
  }
  const contentType = imageTypeOf(read.value);
  return contentType === undefined ? err("format") : ok({ contentType, bytes: read.value });
}

/** Creates an {@link ImageHold} over the owner's image source. */
export function createImageHold(options: ImageHoldOptions): ImageHold {
  const { source, clock } = options;
  const keepMs = options.keepMs ?? 120_000;
  const most = options.most ?? 8;
  const held = new Map<string, Entry>();
  const forget = (): void => {
    for (const [key, entry] of held) {
      if (entry.untilMs <= clock.now()) {
        held.delete(key);
      }
    }
  };
  const keep = (key: string, image: HeldImage): void => {
    held.set(key, { image, untilMs: clock.now() + keepMs });
    // A Map keeps the order its keys came in: the first is the oldest.
    for (const oldest of [...held.keys()].slice(0, Math.max(0, held.size - most))) {
      held.delete(oldest);
    }
  };
  return {
    async read(key, image, call) {
      forget();
      const kept = held.get(key);
      if (kept !== undefined) {
        call.signal.throwIfAborted();
        return ok(kept.image);
      }
      const read = await readOnce(source, image, call);
      if (read.ok) {
        keep(key, read.value);
      }
      return read;
    },
    drop: (key) => {
      held.delete(key);
    },
  };
}
