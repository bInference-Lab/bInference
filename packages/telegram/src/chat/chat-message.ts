import type { ChatPost } from "../updates/chat-update.schema.js";

/** What a batch of the owner's posts becomes: one message for the agent, and what it left out. */
export interface ChatMessage {
  /** The posts' texts and captions, one after another, a line apart. */
  readonly text: string;
  /** The photos the message carries, as `tg:<file id>`: at most 4. */
  readonly images: readonly string[];
  /** Photos past the 4 one message carries. */
  readonly leftOut: number;
  /** Photos over {@link maxPhotoBytes}. */
  readonly tooLarge: number;
}

// The most photos one message to the agent carries (protocol spec, section 7.7).
const maxPhotos = 4;

/** The largest photo the agent reads: 5 MiB (protocol spec, section 7.7). */
export const maxPhotoBytes: number = 5 * 1024 * 1024;

// Telegram's file ids are URL-safe base64; with `tg:` they fit an upload id's 128 characters.
const fileIdPattern = /^[A-Za-z0-9_-]{1,125}$/;

/**
 * Joins a batch of the owner's posts into one message for the agent, in the order they came. A
 * photo over 5 MiB by Telegram's own count is left out, and so is every photo past the first 4
 * that fit; the message counts both, so the owner can be told.
 */
export function chatMessageOf(posts: readonly ChatPost[]): ChatMessage {
  const text = posts
    .flatMap((post) => (post.text === undefined || post.text === "" ? [] : [post.text]))
    .join("\n");
  const photos = posts.flatMap((post) => (post.photo === undefined ? [] : [post.photo]));
  const fitting = photos.filter((photo) => (photo.sizeBytes ?? 0) <= maxPhotoBytes);
  const named = fitting.filter((photo) => fileIdPattern.test(photo.fileId));
  const kept = named.slice(0, maxPhotos);
  return {
    text,
    images: kept.map((photo) => `tg:${photo.fileId}`),
    leftOut: fitting.length - kept.length,
    tooLarge: photos.length - fitting.length,
  };
}
