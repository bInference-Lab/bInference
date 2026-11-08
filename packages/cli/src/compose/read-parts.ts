import { type ProtocolId, protocolIdSchema } from "@binference/protocol";

/** One part of something the engine answers in parts: its bytes in base64, and where the next starts. */
interface Part {
  readonly data: string;
  readonly next?: number;
}

/**
 * Reads something the engine answers in parts whole, in order, up to `maxBytes`; `undefined` when
 * a part is refused. `part` asks for the part at an offset.
 */
async function readParts(
  part: (offset: number) => Promise<Part | undefined>,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  const pieces: Buffer[] = [];
  let offset: number | undefined = 0;
  while (offset !== undefined && offset < maxBytes) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the engine answers the parts in order
    const read = await part(offset);
    if (read === undefined) {
      return undefined;
    }
    pieces.push(Buffer.from(read.data, "base64"));
    offset = read.next;
  }
  return new Uint8Array(Buffer.concat(pieces));
}

/** Who asks the engine for a part on Telegram: the owner's numeric id, for one agent. */
export interface OwnerAsk {
  readonly senderId: number;
  readonly agent: ProtocolId<"agent">;
}

/**
 * Reads a file the agent's chat showed, whole, as the owner on Telegram: `undefined` before the
 * owner pairs, for an agent id the protocol does not read, or once a part is refused. `part` asks
 * the engine for the part at an offset; an offset of 0 is left out of the call.
 */
export async function readAsOwner(
  ask: {
    readonly ownerId: (call: { readonly signal: AbortSignal }) => Promise<number | undefined>;
    readonly agent: string;
    readonly maxBytes: number;
  },
  part: (asker: OwnerAsk, offset: { readonly offset?: number }) => Promise<Part | undefined>,
  call: { readonly signal: AbortSignal },
): Promise<Uint8Array | undefined> {
  const senderId = await ask.ownerId(call);
  const agent = protocolIdSchema("agent").safeParse(ask.agent);
  if (senderId === undefined || !agent.success) {
    return undefined;
  }
  const asker = { senderId, agent: agent.data };
  return readParts(async (offset) => part(asker, offset === 0 ? {} : { offset }), ask.maxBytes);
}
