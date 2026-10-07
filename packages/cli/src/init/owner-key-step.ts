import { timingSafeEqual } from "node:crypto";
import { ok, type Secret } from "@binference/core";
import { createP256KeyPair, formatOwnerKeyCode } from "@binference/signer";
import { type InitContext, type InitStep, refused } from "./init-context.js";

/** The owner key as init keeps it: its public half, and its code until the run ends. */
export interface OwnerKey {
  /** DER SubjectPublicKeyInfo in base64: what owns the wallets on Privy. */
  readonly publicKey: string;
  /** The `bnok1` code, shown once; a run without a person gives it in its JSON answer. */
  readonly code: Secret;
}

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

async function checkBack(context: InitContext, expected: string, tries: number): Promise<boolean> {
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
 * The owner key step (keys spec, section 2, step 2): makes a P-256 key pair from the OS CSPRNG
 * and shows its private half once, as its `bnok1` code. A person types back the code's last 6
 * characters, its base32 characters without the group spaces; three wrong check-backs stop init
 * before anything is made, and the key is gone. Init keeps only the public half.
 */
export async function makeOwnerKey(context: InitContext): Promise<InitStep<OwnerKey>> {
  const pair = createP256KeyPair();
  const code = formatOwnerKeyCode(pair);
  context.prompter.note(
    context.words("ownerKey.show", { code: code.reveal() }),
    context.words("ownerKey.title"),
  );
  const expected = codeCharacters(code.reveal()).slice(-checkLength);
  if (context.isInteractive && !(await checkBack(context, expected, 1))) {
    return refused("init.owner_key_unconfirmed", "refused.ownerKeyUnconfirmed");
  }
  if (context.isInteractive) {
    context.prompter.say(context.words("ownerKey.checked"));
  }
  return ok({ publicKey: pair.publicKey, code });
}
