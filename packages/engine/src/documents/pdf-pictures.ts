import type { Clock } from "@binference/core";
import type { HeldImage } from "../chat/image-hold.js";

/**
 * The pictures of the PDFs' pages the engine drew, held while the runtime reads them in parts
 * (decision 0402): each document's for 2 minutes, at most 4 documents at once, each page let go
 * once its last part is read.
 */
export interface PdfPictures {
  /** Holds a document's pictures by page, under the agent that read it. */
  keep(agent: string, document: string, pictures: ReadonlyMap<number, HeldImage>): void;
  /** A page's picture, `gone` once the document is no longer held, `undefined` for no such page. */
  find(agent: string, document: string, page: number): HeldImage | "gone" | undefined;
  /** Lets a page's picture go: its last part was read. */
  drop(agent: string, document: string, page: number): void;
}

interface Held {
  readonly pictures: Map<number, HeldImage>;
  readonly untilMs: number;
}

const keepMs = 120_000;
const most = 4;

function keyOf(agent: string, document: string): string {
  return `${agent} ${document}`;
}

/** Creates the {@link PdfPictures} the engine holds in memory. */
export function createPdfPictures(clock: Clock): PdfPictures {
  const held = new Map<string, Held>();
  const forget = (): void => {
    for (const [key, entry] of held) {
      if (entry.untilMs <= clock.now()) {
        held.delete(key);
      }
    }
  };
  return {
    keep(agent, document, pictures) {
      forget();
      held.set(keyOf(agent, document), {
        pictures: new Map(pictures),
        untilMs: clock.now() + keepMs,
      });
      // A Map keeps the order its keys came in: the first is the oldest.
      for (const oldest of [...held.keys()].slice(0, Math.max(0, held.size - most))) {
        held.delete(oldest);
      }
    },
    find(agent, document, page) {
      forget();
      const entry = held.get(keyOf(agent, document));
      return entry === undefined ? "gone" : entry.pictures.get(page);
    },
    drop(agent, document, page) {
      const key = keyOf(agent, document);
      const entry = held.get(key);
      entry?.pictures.delete(page);
      if (entry?.pictures.size === 0) {
        held.delete(key);
      }
    },
  };
}
