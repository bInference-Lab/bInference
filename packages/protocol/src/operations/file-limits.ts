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
