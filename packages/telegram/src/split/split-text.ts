/** The most characters one Telegram message holds after its entities are parsed. */
export const maxMessageLength = 4096;

// A cut never leaves half of a surrogate pair at the end of a piece.
function cutAt(text: string, length: number): number {
  const last = text.charCodeAt(length - 1);
  const isHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return isHighSurrogate ? length - 1 : length;
}

function piecesOf(line: string, maxLength: number): readonly string[] {
  if (line.length <= maxLength) {
    return [line];
  }
  const at = cutAt(line, maxLength);
  return [line.slice(0, at), ...piecesOf(line.slice(at), maxLength)];
}

/**
 * Splits plain text into messages of at most `maxLength` characters (UTF-16 code units, as the
 * Bot API counts them), each a run of whole lines (cards-and-messages spec, section 1). Only a
 * line longer than a message is cut inside, never between the halves of a surrogate pair.
 */
export function splitText(text: string, maxLength: number = maxMessageLength): readonly string[] {
  const messages: string[] = [];
  for (const line of text.split("\n").flatMap((whole) => piecesOf(whole, maxLength))) {
    const last = messages.at(-1);
    if (last !== undefined && last.length + 1 + line.length <= maxLength) {
      messages[messages.length - 1] = `${last}\n${line}`;
    } else {
      messages.push(line);
    }
  }
  return messages;
}
