import type { credentialPushes } from "@binference/protocol";
import { callOptions, type ChatContext } from "./chat-context.js";
import type { ChatAction } from "./chat-keys.js";
import { failureText } from "./chat-lines.js";
import { withoutCredential } from "./chat-state.js";
import { credentialLines } from "./credential-lines.js";

type ClosedPush = Extract<
  credentialPushes.CredentialPush,
  { readonly kind: "chat/credentialRequestClosed" }
>;

/**
 * The agent's open credential request in terminal chat (decision 0391): a masked entry that takes
 * the owner's keys while the request is open. What the owner types never reaches the chat's state
 * or its screen: the live area shows one dot per character.
 */
export interface CredentialEntry {
  /** Reads the open request with `chat/openCredentialRequest`, and shows it when it is new. */
  reload(): Promise<void>;
  /** Takes the shown request off the live area, saying how it ended. */
  closed(push: ClosedPush): void;
  /** Acts on one key while a request is open. */
  key(action: ChatAction): void;
}

/** The masked characters, kept apart from the chat's store, and where a paste began. */
interface Typed {
  readonly characters: readonly string[];
  readonly pasteFrom?: number;
  readonly isPasteRefused: boolean;
}

const nothingTyped: Typed = { characters: [], isPasteRefused: false };

// A key's text in the masked entry; inside a paste, a line break refuses the whole paste.
function typedText(typed: Typed, text: string): Typed {
  if (typed.pasteFrom !== undefined && /[\r\n]/u.test(text)) {
    return { ...typed, isPasteRefused: true };
  }
  return { ...typed, characters: [...typed.characters, ...Array.from(text)] };
}

// The end of a paste: a refused one leaves what was typed before it.
function pasteEnded(typed: Typed): Typed {
  const characters = typed.isPasteRefused
    ? typed.characters.slice(0, typed.pasteFrom ?? 0)
    : typed.characters;
  return { characters, isPasteRefused: false };
}

// The editing keys that take no text of their own.
const plainEdits: Partial<Record<ChatAction["kind"], (typed: Typed) => Typed>> = {
  erase: (typed) => ({ ...typed, characters: typed.characters.slice(0, -1) }),
  clearLine: (typed) => ({ ...typed, characters: [] }),
  pasteStart: (typed) => ({
    characters: typed.characters,
    pasteFrom: typed.characters.length,
    isPasteRefused: false,
  }),
  pasteEnd: pasteEnded,
};

// What an editing key does to the masked characters, or `undefined` for a key that edits nothing.
function edited(typed: Typed, action: ChatAction): Typed | undefined {
  if (action.kind === "type") {
    return typedText(typed, action.text);
  }
  return plainEdits[action.kind]?.(typed);
}

// Stores what was typed for the hosts the agent proposed, or skips with no value.
async function answer(context: ChatContext, value: string | undefined): Promise<void> {
  const { client, agent, store, words, print } = context;
  const open = store.get().credential?.request;
  if (open === undefined) {
    return;
  }
  const { request, allowedHosts } = open;
  try {
    await (value === undefined
      ? client.call("credential/skip", { agent, request }, callOptions(context))
      : client.call(
          "credential/answer",
          { agent, request, value, allowedHosts },
          callOptions(context),
        ));
  } catch (error) {
    print([{ text: failureText(words, error), tone: "dim" }]);
  }
}

// Reads the open request and shows it when it is new; a request that changes clears the entry.
async function reloaded(context: ChatContext, forget: () => void): Promise<void> {
  const { client, agent, store } = context;
  const { request } = await client.call(
    "chat/openCredentialRequest",
    { agent },
    callOptions(context),
  );
  if (request?.request === store.get().credential?.request.request) {
    return;
  }
  forget();
  if (request !== undefined) {
    const agentName = context.agentName;
    context.print(credentialLines(context.formatter, { request, agentName }));
  }
  store.update((state) =>
    request === undefined
      ? withoutCredential(state)
      : { ...state, credential: { request, length: 0 } },
  );
}

/**
 * Creates the terminal's masked entry for the agent's credential requests: read when the chat
 * opens, at each request push and after a gap in the agent's chat topic. Enter stores what was
 * typed for the hosts the agent proposed, through `credential/answer`; Esc skips through
 * `credential/skip`. A paste that holds more than one line is refused whole.
 */
export function createCredentialEntry(context: ChatContext): CredentialEntry {
  const { words, store, print } = context;
  let typed = nothingTyped;
  const keep = (next: Typed): void => {
    if (typed.isPasteRefused && !next.isPasteRefused && next.pasteFrom === undefined) {
      print([{ text: words("tui.credential.multiline"), tone: "dim" }]);
    }
    typed = next;
    const length = next.characters.length;
    store.update((state) =>
      state.credential === undefined
        ? state
        : { ...state, credential: { ...state.credential, length } },
    );
  };
  const forget = (): void => {
    typed = nothingTyped;
  };
  return {
    reload: async () => reloaded(context, forget),
    closed: (push) => {
      if (store.get().credential?.request.request === push.request) {
        forget();
        print([{ text: words("tui.credential.closed", { outcome: push.outcome }), tone: "dim" }]);
        store.update(withoutCredential);
      }
    },
    key: (action) => {
      if (action.kind === "send" || action.kind === "stop") {
        const value = typed.characters.join("");
        keep(nothingTyped);
        if (action.kind === "stop" || value !== "") {
          void answer(context, action.kind === "stop" ? undefined : value);
        }
        return;
      }
      const next = edited(typed, action);
      if (next !== undefined) {
        keep(next);
      }
    },
  };
}
