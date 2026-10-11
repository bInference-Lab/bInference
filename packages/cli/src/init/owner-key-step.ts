import { timingSafeEqual } from "node:crypto";
import { ok } from "@binference/core";
import { createP256KeyPair, formatOwnerKeyCode, parseP256PublicKey } from "@binference/signer";
import { type InitContext, type InitStep, refused } from "./init-context.js";

/** The owner key as init keeps it: its public half only. */
export interface OwnerKey {
  /** DER SubjectPublicKeyInfo in base64: what owns the wallets on Privy. */
  readonly publicKey: string;
}

/** What making an owner key needs: the person at the terminal, and the `init` messages. */
export type OwnerKeyContext = Pick<InitContext, "prompter" | "isInteractive" | "words">;

// How many check-backs a person may type before init stops and forgets the key.
const maxTries = 3;
const checkLength = 6;

// The code's characters without its group spaces, in lower case.
function codeCharacters(text: string): string {
  return text.replaceAll(/[\s-]/g, "").toLowerCase();
}

function matches(typed: string, expected: string): boolean {
  const left = Buffer.from(codeCharacters(typed), "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

async function checkBack(
  context: OwnerKeyContext,
  expected: string,
  tries: number,
): Promise<boolean> {
  const typed = await context.prompter.ask({
    id: "ownerKeyCheck",
    message: context.words("ownerKey.checkBack"),
  });
  if (matches(typed, expected)) {
    return true;
  }
  context.prompter.say(context.words("ownerKey.checkWrong", { left: maxTries - tries }));
  return tries < maxTries && checkBack(context, expected, tries + 1);
}

/**
 * Makes the owner key (keys spec, section 2, step 2): a P-256 key pair from the OS CSPRNG, whose
 * private half it shows once as its `bnok1` code, to a person at a terminal only. The person
 * types back the code's last 6 characters, its base32 characters without the group spaces; three
 * wrong check-backs stop before anything is made, and the key is gone. Only the public half is
 * kept. Without a person it makes no key (decision 0148).
 */
export async function makeOwnerKey(context: OwnerKeyContext): Promise<InitStep<OwnerKey>> {
  if (!context.isInteractive) {
    return refused("init.owner_key_needs_terminal", "refused.ownerKeyTerminal");
  }
  const pair = createP256KeyPair();
  const code = formatOwnerKeyCode(pair);
  context.prompter.note(
    context.words("ownerKey.show", { code: code.reveal() }),
    context.words("ownerKey.title"),
  );
  const expected = codeCharacters(code.reveal()).slice(-checkLength);
  if (!(await checkBack(context, expected, 1))) {
    return refused("init.owner_key_unconfirmed", "refused.ownerKeyUnconfirmed");
  }
  context.prompter.say(context.words("ownerKey.checked"));
  return ok({ publicKey: pair.publicKey });
}

/**
 * The owner key step of init: the public half `--owner-key-public` gives, made on a machine with
 * a terminal by `binference owner-key create`, else a new key a person at this terminal writes
 * down. A run with nobody at a terminal and no public half is refused, so no owner key code ever
 * reaches a log or a script's output (decision 0148).
 */
export async function takeOwnerKey(context: InitContext): Promise<InitStep<OwnerKey>> {
  const given = context.flags.ownerKeyPublic;
  if (given === undefined) {
    return makeOwnerKey(context);
  }
  const publicKey = parseP256PublicKey(given);
  return publicKey.ok
    ? ok({ publicKey: publicKey.value })
    : refused("init.bad_owner_key_public", "refused.ownerKeyPublic");
}
