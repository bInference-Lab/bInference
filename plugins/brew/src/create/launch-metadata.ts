import { createHash } from "node:crypto";
import {
  type LaunchPicture,
  type LaunchWords,
  type WrittenPicture,
  type WrittenWords,
  writtenWordsOf,
} from "@binference/plugin-sdk";
import { z } from "zod";

// What a Brew token's metadata address holds, as every launch read on chain on 2026-10-20 writes
// it and brew.family reads it: a `data:application/json;base64,` document with `v` 1, the
// description, the website, X (`twitter`) and Telegram links it gives, and the picture as a
// `data:image/...;base64,` address. BrewFactory takes the address at 2,048 bytes at most.
const documentPrefix = "data:application/json;base64,";
const mostBytes = 2_048;
const pictureTypes = ["image/png", "image/jpeg", "image/webp"] as const;
// The longest picture prefix: `data:image/jpeg;base64,` and `data:image/webp;base64,`.
const longestPicturePrefix = "data:image/webp;base64,";

const bytesOf = (text: string): number => new TextEncoder().encode(text).byteLength;
const base64Of = (bytes: Readonly<Uint8Array> | string): string =>
  Buffer.from(typeof bytes === "string" ? bytes : Uint8Array.from(bytes)).toString("base64");

/** The words and picture a launch's metadata carries. */
interface Metadata {
  readonly words: WrittenWords;
  /** The picture's address: `data:<type>;base64,<bytes>`. */
  readonly image: string;
}

// A word of the document, left out when the launch does not give it.
const given = (key: string, value: string) => (value === "" ? {} : { [key]: value });

// The document with only the words the launch gives, in one order, so the bytes and the words
// say one thing.
function documentOf(metadata: Metadata): string {
  const { description, links } = metadata.words;
  return JSON.stringify({
    v: 1,
    ...given("description", description),
    ...given("website", links.website),
    ...given("twitter", links.x),
    ...given("telegram", links.telegram),
    image: metadata.image,
  });
}

const addressOf = (metadata: Metadata): string =>
  `${documentPrefix}${base64Of(documentOf(metadata))}`;

/**
 * The metadata address a Brew launch's create call writes: its words and the owner's picture, in
 * the document form brew.family reads.
 */
export function launchMetadataOf(words: LaunchWords, picture: LaunchPicture): string {
  const image = `data:${picture.contentType};base64,${base64Of(picture.bytes)}`;
  return addressOf({ words: writtenWordsOf(words), image });
}

// Whether a picture of the bytes fits beside the words in the factory's 2,048 bytes.
function fits(words: WrittenWords, pictureBytes: number): boolean {
  const filler = "A".repeat(Math.ceil(pictureBytes / 3) * 4);
  return bytesOf(addressOf({ words, image: `${longestPicturePrefix}${filler}` })) <= mostBytes;
}

/**
 * The most bytes of a picture the metadata address takes beside the launch's words (decision
 * 0279): 0 when the words alone fill it.
 */
export function pictureBytesFor(words: LaunchWords): number {
  const written = writtenWordsOf(words);
  let low = 0;
  let high = mostBytes;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(written, middle)) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}

const documentSchema = z.strictObject({
  v: z.literal(1),
  description: z.string().min(1).exactOptional(),
  website: z.string().min(1).exactOptional(),
  twitter: z.string().min(1).exactOptional(),
  telegram: z.string().min(1).exactOptional(),
  image: z.string(),
});

const imagePattern = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const pictureTypeSchema = z.enum(pictureTypes);

// The picture an image address names, by its type and the SHA-256 of its bytes.
function pictureOf(image: string): WrittenPicture | undefined {
  const [, type, data] = imagePattern.exec(image) ?? [];
  const contentType = pictureTypeSchema.safeParse(type);
  if (!contentType.success || data === undefined) {
    return undefined;
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.byteLength === 0 || base64Of(bytes) !== data) {
    return undefined;
  }
  return {
    contentType: contentType.data,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** What a create call's metadata address carries: its words and its picture. */
export interface ReadMetadata {
  readonly words: WrittenWords;
  readonly picture: WrittenPicture;
}

function documentIn(address: string): Metadata | undefined {
  if (!address.startsWith(documentPrefix) || bytesOf(address) > mostBytes) {
    return undefined;
  }
  try {
    const text = Buffer.from(address.slice(documentPrefix.length), "base64").toString("utf8");
    const parsed = documentSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return undefined;
    }
    const { description = "", website = "", twitter = "", telegram = "", image } = parsed.data;
    return { words: { description, links: { website, x: twitter, telegram } }, image };
  } catch {
    return undefined;
  }
}

/**
 * The words and picture a create call's metadata address carries, only when the address is
 * exactly what {@link launchMetadataOf} writes for them; any other address: undefined.
 */
export function readLaunchMetadata(address: string): ReadMetadata | undefined {
  const metadata = documentIn(address);
  const picture = metadata === undefined ? undefined : pictureOf(metadata.image);
  return metadata === undefined || picture === undefined || addressOf(metadata) !== address
    ? undefined
    : { words: metadata.words, picture };
}
