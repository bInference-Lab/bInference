import type { Formatter } from "@binference/i18n";
import type { RichLine } from "@binference/rich-text";

/**
 * The caption of an image or file the agent made, showed or sent: where it is on the machine, in
 * `code`, after the words `telegram.chat.madeImage`.
 */
export function savedAtCaption(formatter: Formatter, path: string): readonly RichLine[] {
  // oxlint-disable-next-line eslint/no-restricted-properties -- the formatter's message method picks i18n text by key; no error message is read
  const label = formatter.message("telegram.chat.madeImage");
  return [
    {
      block: { kind: "text" },
      runs: [
        { text: `${label} `, marks: [] },
        { text: path, marks: [{ kind: "code" }] },
      ],
    },
  ];
}
