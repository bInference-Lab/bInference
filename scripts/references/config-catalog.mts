import { configKeyTexts } from "binference";

/** The English `configKeys` catalog, which `pnpm docs:gen` writes from the config schema. */
export const configCatalogFile = "packages/i18n/messages/en/configKeys.json";

// ICU reads these as syntax; a schema text that holds one would read differently as a message.
const syntax = /[{}<>]/u;

/** The English `configKeys` catalog's text: each config key's schema text, by its path. */
export function configCatalogText(): string {
  const entries = [...configKeyTexts()].map(([key, text]) => {
    if (syntax.test(text)) {
      throw new Error(
        `The config schema's text of ${key} holds { } < or >, which a message reads as syntax. ` +
          "Write it without them.",
      );
    }
    return [key.slice("configKeys.".length), text] as const;
  });
  return `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;
}
