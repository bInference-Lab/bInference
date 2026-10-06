/** One area file, `messages/<locale>/<area>.json`: keys inside the area mapped to ICU texts. */
export type AreaMessages = Readonly<Record<string, string>>;

/** One language's area files, by area name. */
export type LocaleMessages = Readonly<Record<string, AreaMessages>>;

/** Every language's area files, by the name of the language's folder. */
export type MessageFiles = Readonly<Record<string, LocaleMessages>>;

/** One problem in the message files: a whole area file, or one key in it. */
export interface MessageProblem {
  readonly locale: string;
  readonly area: string;
  /** The key inside the area, when the problem is about one message. */
  readonly key?: string;
  /** What is wrong and what to do, in one or two sentences. */
  readonly text: string;
}
