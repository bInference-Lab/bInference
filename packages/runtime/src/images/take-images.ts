import { err, ok, type Result } from "@binference/core";
import { maxImagesPerMessage } from "@binference/protocol";
import type { ModelImage, ModelMessage, OwnerMessage } from "../loop/model-message.js";
import type { ImageProblem, ImageReadRefusal } from "../loop/turn-records.js";
import type { TurnRun } from "../loop/turn-run.js";
import { budgetEnd, haltedEnd, type LoopEnd } from "../loop/turn-step.js";
import { describeImage } from "./describe-image.js";
import { describedImageNote } from "./image-notes.js";

const problems: Readonly<Record<ImageReadRefusal, ImageProblem>> = {
  not_found: "unreadable",
  unreadable: "unreadable",
  too_large: "tooLarge",
  format: "format",
};

/** A message the turn took, with the images read for it, and where its entry sits. */
interface ReadMessage {
  readonly message: OwnerMessage;
  readonly images: readonly ModelImage[];
  /** The index of the message's entry in the turn's conversation. */
  readonly at: number;
}

function imageEnd(problem: ImageProblem): LoopEnd {
  return { outcome: "failed", status: { line: "image", problem } };
}

// Every image of every message, one at a time and in order, the first refusal ending the reads.
async function readAll(
  run: TurnRun,
  taken: readonly { readonly message: OwnerMessage; readonly at: number }[],
): Promise<Result<readonly ReadMessage[], ImageProblem>> {
  const { readImage } = run.parts;
  const read: ReadMessage[] = [];
  for (const { message, at } of taken) {
    const images: ModelImage[] = [];
    for (const image of message.images ?? []) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one image in memory at a time
      const got = await (readImage?.({ message: message.id, image }, run.halted) ??
        Promise.resolve(err("unreadable" as const)));
      if (!got.ok) {
        return err(problems[got.error]);
      }
      images.push(got.value);
    }
    read.push({ message, images, at });
  }
  return ok(read);
}

// The images go with their messages: each entry carries its images before its text.
function attach(run: TurnRun, read: readonly ReadMessage[]): void {
  for (const { images, at } of read) {
    const entry = run.messages[at];
    if (entry?.role === "owner") {
      run.messages.splice(at, 1, { ...entry, images });
    }
  }
}

// The vision model describes each image; each description is kept as outside content and follows
// its message as an entry of its own, so its words are never the owner's.
async function describeAll(
  run: TurnRun,
  read: readonly ReadMessage[],
): Promise<LoopEnd | undefined> {
  const { vision, journal } = run.parts;
  if (vision === undefined) {
    return imageEnd("noVision");
  }
  // From the last message back, so each insert leaves the earlier indexes as they were.
  for (const { message, images, at } of read.toReversed()) {
    const entries: ModelMessage[] = [];
    for (const [index, image] of images.entries()) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one vision call at a time, in order
      const said = await describeImage(run, vision, image);
      if (!said.ok) {
        return said.end;
      }
      const place = index + 1;
      // oxlint-disable-next-line eslint/no-await-in-loop -- kept before the main model reads it
      await journal.described({ message: message.id, place, text: said.text }, run.writes);
      entries.push({ role: "owner", text: describedImageNote(place, said.text) });
    }
    run.messages.splice(at + 1, 0, ...entries);
  }
  return run.tally.now().budgetSpent ? budgetEnd(run) : undefined;
}

/**
 * Reads the images of the messages the turn took, before its first model call (decision 0227):
 * at most 4 a message, each whole from the engine, which refuses one over 5 MiB or in a format
 * the agent cannot read. The turn's model gets them with their messages when it takes images;
 * otherwise the vision model describes each one, and with no vision model the turn ends. Answers
 * how the turn ends, or `undefined` when its first model call may go. `firstTaken` is the index
 * of the first taken message's entry in the conversation.
 */
export async function takeImages(
  run: TurnRun,
  taken: readonly OwnerMessage[],
  firstTaken: number,
): Promise<LoopEnd | undefined> {
  const withImages = taken
    .map((message, index) => ({ message, at: firstTaken + index }))
    .filter(({ message }) => (message.images?.length ?? 0) > 0);
  if (withImages.length === 0) {
    return undefined;
  }
  if (withImages.some(({ message }) => (message.images?.length ?? 0) > maxImagesPerMessage)) {
    return imageEnd("tooMany");
  }
  try {
    const read = await readAll(run, withImages);
    if (!read.ok) {
      return imageEnd(read.error);
    }
    if (run.parts.models.models[run.route.at()]?.readsImages === true) {
      attach(run, read.value);
      return undefined;
    }
    return await describeAll(run, read.value);
  } catch (error) {
    if (run.halted.aborted) {
      return haltedEnd(run);
    }
    throw error;
  }
}
