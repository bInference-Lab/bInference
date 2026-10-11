import {
  createFormatter,
  type Formatter,
  type MessageLocale,
  type MessageValues,
} from "@binference/i18n";
import { createContext, type ReactNode, useContext } from "react";

/** The message under a full key, such as `console.signIn.title`, with its values filled in. */
export type Words = (key: string, values?: MessageValues) => string;

/** The words of a formatter's language. */
export function wordsOf(formatter: Formatter): Words {
  // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
  return (key, values) => formatter.message(key, values);
}

/** The console's language: Chinese for a browser set to any Chinese, English otherwise. */
export function localeOf(language: string): MessageLocale {
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** The formatter for the owner's language and timezone; UTC when the browser does not know it. */
export function formatterFor(locale: MessageLocale, timeZone: string): Formatter {
  try {
    return createFormatter({ locale, timeZone });
  } catch {
    return createFormatter({ locale, timeZone: "UTC" });
  }
}

const TextContext = createContext<Formatter>(formatterFor("en", "UTC"));

/** Gives every screen below it the formatter of the owner's language. */
export function TextProvider(props: {
  readonly formatter: Formatter;
  readonly children: ReactNode;
}): React.JSX.Element {
  return <TextContext value={props.formatter}>{props.children}</TextContext>;
}

/** The formatter of the owner's language, for amounts and times. */
export function useFormatter(): Formatter {
  return useContext(TextContext);
}

/** The words of the owner's language. */
export function useText(): Words {
  return wordsOf(useContext(TextContext));
}

// The text in pieces: every other piece between backticks is code, keyed by where it starts.
function codeSpans(text: string): readonly React.ReactNode[] {
  const parts = text.split("`");
  const starts = parts.map((_part, index) =>
    parts.slice(0, index).reduce((sum, part) => sum + part.length + 1, 0),
  );
  return parts.map((part, index) => {
    const start = starts[index] ?? 0;
    return index % 2 === 1 ? (
      <code key={start} className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em]">
        {part}
      </code>
    ) : (
      <span key={start}>{part}</span>
    );
  });
}

/** A message whose `code` spans show as code, such as `binference console`. */
export function MessageText(props: { readonly text: string }): React.JSX.Element {
  return <>{codeSpans(props.text)}</>;
}
