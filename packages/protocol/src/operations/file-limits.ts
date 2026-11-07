/** The most characters of text one file call carries: a write's content or a patch. */
export const maxFileTextChars: number = 512 * 1024;

/** The most lines one `file/read` answers. */
export const maxFileReadLines: number = 2_000;

/**
 * The most bytes of text one `file/read` answers: 10 KiB, so a page and its note fit in the
 * 12,000 characters of a tool result the agent reads.
 */
export const maxFileReadBytes: number = 10 * 1024;
