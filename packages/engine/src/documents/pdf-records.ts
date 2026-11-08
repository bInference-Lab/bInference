/**
 * A PDF to read: its bytes, the pages asked for (1-based, in order, at most 20; the first 20 when
 * absent), and the password of an encrypted one, which is never logged or kept.
 */
export interface PdfRequest {
  readonly bytes: Readonly<Uint8Array>;
  readonly pages?: readonly number[];
  readonly password?: string;
}

/** One page read: its number, its text, and a JPEG of it when its text was too little. */
export interface PdfPage {
  readonly page: number;
  readonly text: string;
  readonly picture?: Readonly<Uint8Array>;
}

/**
 * What a PDF held: the pages read, in order, its page count, and what was cut: text past 100,000
 * characters, pages asked for past its end or past the 20 read, pictures left out or drawn
 * smaller to stay within 4 million pixels.
 */
export interface PdfContent {
  readonly totalPages: number;
  readonly pages: readonly PdfPage[];
  readonly textCut: boolean;
  readonly pagesCut: boolean;
  readonly imagesCut: boolean;
}

/**
 * Why a PDF has nothing to read: it is no PDF, it needs a password or another one, none of the
 * pages asked for are in it, it is broken, or it took longer than its time to read.
 */
export type PdfRefusal = "not_pdf" | "password" | "no_pages" | "unreadable" | "timed_out";
