/** Parses JSON text for a schema to check; text that is not JSON gives `undefined`. */
export function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
