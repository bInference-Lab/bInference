import { IntlMessageFormat } from "intl-messageformat";
import { Fragment, type ReactNode } from "react";
import en from "../../../../packages/i18n/messages/en/web.json" with { type: "json" };
import zh from "../../../../packages/i18n/messages/zh/web.json" with { type: "json" };

/** The languages the site ships in. */
export type Locale = "en" | "zh";

/** A key of the i18n `web` area. */
type WordKey = keyof typeof en;

const catalogs: Readonly<Record<Locale, Readonly<Record<WordKey, string>>>> = { en, zh };
const intlLocale: Readonly<Record<Locale, string>> = { en: "en", zh: "zh-Hans" };

/** The site's words in one language, read at build time; only server code formats them. */
export interface Words {
  readonly locale: Locale;
  /** The message as plain text, its tags left out. */
  text(key: WordKey): string;
  /** The message with its tags drawn: `b`, `light`, `gold`, `br` and the gold full stop `dot`. */
  rich(key: WordKey): ReactNode;
  /** As `rich`, each word in its own mask, so it can rise when its heading comes into view. */
  split(key: WordKey): ReactNode;
}

type Wrap = (chunk: string) => ReactNode;

// Each part gets a key of its own, counted in order, so React can tell the parts apart.
function keyed(parts: readonly ReactNode[]): ReactNode {
  let count = 0;
  return parts.map((part) => {
    count += 1;
    return <Fragment key={`p${String(count)}`}>{part}</Fragment>;
  });
}

function tags(wrap: Wrap): Readonly<Record<string, (chunks: readonly ReactNode[]) => ReactNode>> {
  const inner = (chunks: readonly ReactNode[]): ReactNode =>
    keyed(chunks.map((chunk) => (typeof chunk === "string" ? wrap(chunk) : chunk)));
  return {
    b: (chunks) => <b>{inner(chunks)}</b>,
    light: (chunks) => <span className="second">{inner(chunks)}</span>,
    gold: (chunks) => <b className="gold">{inner(chunks)}</b>,
    br: () => <br />,
    dot: () => <i className="stop" />,
  };
}

function formatted(locale: Locale, key: WordKey, wrap: Wrap): ReactNode {
  const message = new IntlMessageFormat(catalogs[locale][key], intlLocale[locale]);
  const out = message.format<ReactNode>(tags(wrap));
  const parts: readonly ReactNode[] = Array.isArray(out) ? out : [out];
  return keyed(parts.map((part) => (typeof part === "string" ? wrap(part) : part)));
}

// Each word sits in a mask and rides up after the ones before it (--n sets its delay).
function wordMasks(): Wrap {
  let n = 0;
  return (chunk) =>
    keyed(
      chunk.split(/(\s+)/).map((piece) => {
        if (piece === "") {
          return null;
        }
        if (/^\s+$/.test(piece)) {
          return " ";
        }
        const index = n++;
        return (
          <span key={`w${String(index)}`} className="sw">
            <span className="si" style={{ "--n": index }}>
              {piece}
            </span>
          </span>
        );
      }),
    );
}

/** The site's words for `locale`. */
export function wordsFor(locale: Locale): Words {
  return {
    locale,
    text: (key) => catalogs[locale][key].replaceAll(/<\/?[a-z]+>/g, ""),
    rich: (key) => formatted(locale, key, (chunk) => chunk),
    split: (key) => formatted(locale, key, wordMasks()),
  };
}
