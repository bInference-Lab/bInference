/** What a {@link Secret} shows wherever it is printed, logged or serialized. */
export const secretMark = "[secret]";

// Node's util.inspect, and so console.log and the logger, call the method under this symbol.
const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

const hidden = (): string => secretMark;

/**
 * A secret value, such as a bot token or an API key. Its text, its JSON and its inspected form
 * are all {@link secretMark}; only {@link Secret.reveal} returns the value, so a secret reaches a
 * log, an error or a config dump only when code reveals it on purpose.
 */
export interface Secret {
  /** The value. Call it only where the secret is used, such as a request header. */
  reveal(): string;
  toString(): string;
  toJSON(): string;
}

/**
 * Wraps a value as a {@link Secret}. The value lives in a closure, so no property, spread, clone
 * or inspection of the object reaches it.
 */
export function createSecret(value: string): Secret {
  return Object.freeze({
    reveal: (): string => value,
    toString: hidden,
    toJSON: hidden,
    [Symbol.toPrimitive]: hidden,
    [inspectSymbol]: hidden,
  });
}
