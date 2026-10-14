import { type GeniusRead, unreadable } from "../contracts/read-genius.js";
import { blockStampSchema, type BlockStamp } from "./block-answers.schema.js";

// Headers read before the search gives up. Blocks keep a near-even pace, so guessing by it ends
// in a few steps; past `pacedSteps` the search halves, which ends on any pace.
const maxSteps = 48;
const pacedSteps = 16;
// Blocks per second assumed when stepping back from the head: more than any EVM chain the venue
// serves makes, so the first step lands before the launch.
const blocksPerSecond = 4n;

async function stampOf(read: GeniusRead, block: bigint | "latest"): Promise<BlockStamp> {
  const tag = block === "latest" ? block : `0x${block.toString(16)}`;
  const reply = await read.rpc.request({
    method: "eth_getBlockByNumber",
    params: [tag, false],
    result: blockStampSchema,
    signal: read.signal,
  });
  if (reply.kind === "error") {
    throw unreadable(`block ${String(block)} could not be read.`);
  }
  return reply.value;
}

/** Two blocks the launch second lies between: the earlier made before it, the later not. */
interface Bracket {
  readonly before: BlockStamp;
  readonly after: BlockStamp;
}

/** Where a search stands: the second sought, the blocks it lies between, and the steps taken. */
interface Search {
  readonly second: bigint;
  readonly bracket: Bracket;
  readonly step: number;
}

// A block before the second, stepping back from the head four times further each time.
async function bracketOf(read: GeniusRead, search: Search, back: bigint): Promise<Bracket> {
  const { after } = search.bracket;
  const number = after.number > back ? after.number - back : 0n;
  const stamp = await stampOf(read, number);
  if (stamp.timestamp < search.second || number === 0n) {
    return { before: stamp, after };
  }
  return bracketOf(read, search, back * 4n);
}

// The guess between the bracket's ends: where the second falls at the bracket's own pace, then,
// past the paced steps, the middle; always strictly between the two ends.
function guessOf({ bracket, second, step }: Search): bigint {
  const { before: low, after: high } = bracket;
  const span = high.number - low.number;
  const elapsed = high.timestamp - low.timestamp;
  const isPaced = step < pacedSteps && elapsed > 0n;
  const guess = low.number + (isPaced ? ((second - low.timestamp) * span) / elapsed : span / 2n);
  if (guess <= low.number) {
    return low.number + 1n;
  }
  return guess >= high.number ? high.number - 1n : guess;
}

async function narrow(read: GeniusRead, search: Search): Promise<BlockStamp> {
  const { bracket, second, step } = search;
  if (bracket.after.number - bracket.before.number <= 1n) {
    return bracket.after;
  }
  if (step >= maxSteps) {
    throw unreadable("the launch's block could not be found.");
  }
  const stamp = await stampOf(read, guessOf(search));
  const next =
    stamp.timestamp < second ? { ...bracket, before: stamp } : { ...bracket, after: stamp };
  return narrow(read, { second, bracket: next, step: step + 1 });
}

// The blocks from `first` on made in the same second, read one after another.
async function sameSecond(
  read: GeniusRead,
  first: BlockStamp,
  head: bigint,
): Promise<readonly bigint[]> {
  if (first.number >= head) {
    return [first.number];
  }
  const next = await stampOf(read, first.number + 1n);
  return next.timestamp === first.timestamp
    ? [first.number, ...(await sameSecond(read, next, head))]
    : [first.number];
}

/**
 * The blocks made in one second of the chain's clock, such as the second a launch's curve names
 * as its launch: found between the head and a block stepped back from it, by its pace and by
 * halving, then read forward. A second after the head, one no block was made in, or a search that
 * does not end within its steps, is a fault (`geniusfun.read_failed`). Rejects when no node
 * answers, and with the signal's reason once it aborts.
 */
export async function blocksOfSecond(read: GeniusRead, second: bigint): Promise<readonly bigint[]> {
  const head = await stampOf(read, "latest");
  if (head.timestamp < second) {
    throw unreadable("the launch is newer than the chain's head.");
  }
  const back = (head.timestamp - second + 1n) * blocksPerSecond;
  const start = { second, bracket: { before: head, after: head }, step: 0 };
  const bracket = await bracketOf(read, start, back);
  const first =
    bracket.before.timestamp >= second
      ? bracket.before
      : await narrow(read, { second, bracket, step: 0 });
  if (first.timestamp !== second) {
    throw unreadable("no block was made in the launch's second.");
  }
  return sameSecond(read, first, head.number);
}
