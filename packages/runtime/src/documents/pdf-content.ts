import type { ReadPdf } from "./read-pdfs.js";

/**
 * What a call read beyond its PDFs: how many scanned pages the engine drew, how many a model saw,
 * whether a model of the turn takes images, and whether pages asked for were left out.
 */
export interface ReadTold {
  readonly drawn: number;
  readonly seen: number;
  readonly readsImages: boolean;
  readonly selectionCut: boolean;
}

// A PDF's name as the model reads it: the last part of its path or address.
function shortName(name: string): string {
  const last = name.split(/[\\/]/u).findLast((part) => part !== "");
  return last ?? name;
}

function pagesText(read: ReadPdf["read"]): string {
  return read.pages
    .map(({ page, text, image }) => {
      const scanned = image === undefined ? "" : " (scanned: its picture follows, in page order)";
      return `--- Page ${String(page)}${scanned} ---\n${text.trim()}`;
    })
    .join("\n");
}

/** The PDFs' pages as one text a model reads: each PDF's name, its pages and each page's text. */
export function contentText(reads: readonly ReadPdf[]): string {
  return reads
    .map(({ name, read }, index) => {
      const head = `[PDF ${String(index + 1)}: ${shortName(name)}, ${String(read.totalPages)} pages]`;
      return `${head}\n${pagesText(read)}`;
    })
    .join("\n\n");
}

// Pages as the agent writes them: single numbers, and runs as first-last.
function pageList(pages: readonly number[]): string {
  const runs: [number, number][] = [];
  for (const page of pages) {
    const last = runs.at(-1);
    if (last?.[1] === page - 1) {
      last[1] = page;
    } else {
      runs.push([page, page]);
    }
  }
  return runs
    .map(([first, end]) => (first === end ? String(first) : `${String(first)}-${String(end)}`))
    .join(",");
}

function notesOfOne({ name, read }: ReadPdf): readonly string[] {
  const label = shortName(name);
  const pages = read.pages.map((each) => each.page);
  const listed = `${label}: read page${pages.length === 1 ? "" : "s"} ${pageList(pages)} of ${String(read.totalPages)}.`;
  return [
    listed,
    ...(read.pagesCut
      ? [`${label}: more pages are left; read them with pages, 20 at a time.`]
      : []),
    ...(read.textCut ? [`${label}: its text was cut at 100,000 characters.`] : []),
    ...(read.imagesCut
      ? [
          `${label}: some scanned pages were drawn smaller or left out, to stay within their pixels.`,
        ]
      : []),
  ];
}

/**
 * The lines after a model's answer: the pages read of each PDF, what was cut, and the scanned pages
 * no model saw, with the settings that would let one see them.
 */
export function notesOf(reads: readonly ReadPdf[], pictures: ReadTold): readonly string[] {
  const unseen = pictures.drawn - pictures.seen;
  return [
    ...reads.flatMap((read) => notesOfOne(read)),
    ...(pictures.selectionCut ? ["Only the first 20 pages asked for were read."] : []),
    ...(!pictures.readsImages && unseen > 0
      ? [
          `${String(unseen)} scanned page${unseen === 1 ? " was" : "s were"} read as text alone: no model of this agent takes images. The owner sets one in models.imageInput or models.vision.`,
        ]
      : []),
    ...(pictures.readsImages && unseen > 0
      ? [`${String(unseen)} scanned pages were left out: read fewer of them a call.`]
      : []),
  ];
}
