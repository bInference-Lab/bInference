import type { Clock } from "@binference/core";
import type { ChatPost } from "../updates/chat-update.schema.js";

/** The owner's posts in one chat that go to the agent as one message. */
export interface PostBatch {
  readonly chatId: number;
  readonly senderId: number;
  readonly posts: readonly ChatPost[];
}

/** Gathers the owner's posts into batches by chat, each closed by a quiet window. */
export interface PostBatches {
  /** Adds a post from its sender to its chat's open batch, or opens one. */
  add(post: ChatPost, senderId: number): void;
  /** Drops every open batch. */
  clear(): void;
}

/** What {@link createPostBatches} works with. */
export interface PostBatchesContext {
  readonly clock: Clock;
  /** Ends every window; the batches open then never close. */
  readonly stop: AbortSignal;
  /** Takes each batch once its window closes. */
  readonly onBatch: (batch: PostBatch) => void;
}

// Pasted text comes as several messages and an album as one per photo: parts this close join.
const batchWindowMs = 300;
// A batch closes at once past these, so a long paste never waits on its own.
const maxBatchPosts = 12;
const maxBatchText = 50_000;
const maxBatchAgeMs = 3_000;

interface OpenBatch extends PostBatch {
  readonly firstAtMs: number;
}

function isFull(batch: OpenBatch, now: number): boolean {
  const text = batch.posts.reduce((length, post) => length + (post.text?.length ?? 0), 0);
  return (
    batch.posts.length >= maxBatchPosts ||
    text >= maxBatchText ||
    now - batch.firstAtMs >= maxBatchAgeMs
  );
}

/**
 * Creates the batches of the owner's posts: a chat's batch closes 300 ms after its last post, or
 * at once when it holds 12 posts, 50,000 characters, or posts over 3 seconds.
 */
export function createPostBatches(context: PostBatchesContext): PostBatches {
  const { clock, stop } = context;
  const open = new Map<number, OpenBatch>();
  // Each chat's wait for its next post; a post ends the wait before it and starts its own.
  const windows = new Map<number, AbortController>();
  const close = (chatId: number): void => {
    windows.get(chatId)?.abort();
    windows.delete(chatId);
    const batch = open.get(chatId);
    open.delete(chatId);
    if (batch !== undefined) {
      context.onBatch({ chatId, senderId: batch.senderId, posts: batch.posts });
    }
  };
  const wait = (chatId: number): void => {
    windows.get(chatId)?.abort();
    const window = new AbortController();
    windows.set(chatId, window);
    clock.sleep(batchWindowMs, AbortSignal.any([stop, window.signal])).then(
      () => close(chatId),
      () => undefined,
    );
  };
  return {
    add(post, senderId) {
      const before = open.get(post.chatId);
      const batch: OpenBatch = {
        chatId: post.chatId,
        senderId,
        posts: [...(before?.posts ?? []), post],
        firstAtMs: before?.firstAtMs ?? clock.now(),
      };
      open.set(post.chatId, batch);
      if (isFull(batch, clock.now())) {
        close(post.chatId);
      } else {
        wait(post.chatId);
      }
    },
    clear() {
      for (const window of windows.values()) {
        window.abort();
      }
      windows.clear();
      open.clear();
    },
  };
}
