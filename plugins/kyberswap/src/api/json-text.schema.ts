/** Parses JSON text from KyberSwap's API; text that is not JSON is undefined, never a throw. */
export function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
