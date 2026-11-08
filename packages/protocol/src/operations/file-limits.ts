/** The most characters of text one file call carries: a write's content or a patch. */
export const maxFileTextChars: number = 512 * 1024;

/** The most lines one `file/read` answers. */
export const maxFileReadLines: number = 2_000;

/**
 * The most bytes of text one `file/read` answers: 10 KiB, so a page and its note fit in the
 * 12,000 characters of a tool result the agent reads.
 */
export const maxFileReadBytes: number = 10 * 1024;

/** The largest file the agent sends the owner in the chat: 20 MiB (decision 0400). */
export const maxSentFileBytes: number = 20 * 1024 * 1024;

/** The most files one `file/send` sends (decision 0400). */
export const maxSentFiles: number = 10;

/** The most bytes of a sent file one `file/fetch` answer carries: 512 KiB. */
export const sentFilePartBytes: number = 512 * 1024;

/** The largest PDF the agent reads: 10 MiB (decision 0402). */
export const maxPdfBytes: number = 10 * 1024 * 1024;

/** The most pages one `pdf/read` reads; a longer document answers its first pages. */
export const maxPdfPages: number = 20;

/** The most characters of a PDF's text one `pdf/read` answers, across its pages. */
export const maxPdfTextChars: number = 100_000;

/**
 * A page whose text has fewer characters than this is read as a picture too: a scanned page, or
 * one whose words are drawn as shapes.
 */
export const minPageTextChars: number = 200;

/** The most pixels of the pictures of one PDF's pages, shared by every page drawn. */
export const maxPdfPixels: number = 4_000_000;

/** The most PDFs one `read_pdf` call reads. */
export const maxPdfsPerCall: number = 10;

/** The longest password of an encrypted PDF. */
export const maxPdfPasswordChars: number = 1_024;
