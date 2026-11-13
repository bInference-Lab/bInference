import { recoveryPhraseSpans } from "@binference/core";

// A private key block in PEM form, whatever its kind of key.
const privateKeyBlock =
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/g;

const hiddenKey = "[private key hidden]";
const hiddenPhrase = "[recovery phrase hidden]";

/**
 * Hides what would let anyone take funds from a command's output before the model reads it
 * (decision 0378): private key blocks in PEM form, and recovery phrases as `recoveryPhraseSpans`
 * of `@binference/core` finds them. A bare 64-character hex string stays, since a transaction hash
 * looks the same.
 */
export function maskShellOutput(text: string): string {
  const keysHidden = text.replace(privateKeyBlock, hiddenKey);
  let masked = "";
  let from = 0;
  for (const span of recoveryPhraseSpans(keysHidden)) {
    masked += keysHidden.slice(from, span.start) + hiddenPhrase;
    from = span.end;
  }
  return masked + keysHidden.slice(from);
}
