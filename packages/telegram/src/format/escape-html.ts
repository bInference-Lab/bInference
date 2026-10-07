/**
 * Escapes text for Telegram's HTML parse mode: `&`, `<` and `>` become entities, so any text
 * shows as itself and never as a tag. Escape every line before it joins a message.
 */
export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
