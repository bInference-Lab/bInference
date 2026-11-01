import type { JsonValue } from "@binference/core";
import { z } from "zod";
import { type ChainRef, chainRefSchema } from "../caip/chain-ref.js";
import { kebabCaseSchema } from "../registry/chain-definition.js";
import { type WalletRole, walletRoleSchema } from "../signing/wallet-role.js";
import type {
  CurveReader,
  InsiderReader,
  Launcher,
  LaunchReader,
  PriceReader,
  Quoter,
  TxBuilder,
  TxDecoder,
} from "./ports.js";

/**
 * The inputs of a bridge deposit a ceiling binds (decision 0302), each a top-level input of the
 * call: the account the destination chain pays, a 20-byte address or 32 bytes for a chain such as
 * Solana (decision 0313), the destination chain's id, the token that leaves and the token that
 * arrives, and the `bytes` inputs that must be empty, such as a message that would run actions on
 * arrival. `minOut` names the number input a fill pays at least, which the signer holds to the
 * confirmed plan's least output, and `amountIn` the number input that carries the amount sent,
 * which the signer holds equal to the plan's amount when the venue names it.
 */
export interface BridgeCallInputs {
  readonly recipient: string;
  readonly destinationChain: string;
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly minOut: string;
  readonly amountIn?: string;
  readonly emptyInputs: readonly string[];
}

/** A function a venue's transactions call on one of its contracts. */
export interface VenueCall {
  /** The contract's name, one of the chain's `names` or `launchContracts`. */
  readonly contract: string;
  /** The function as its chain family describes it: for an EVM venue, its JSON ABI entry. */
  readonly abi: JsonValue;
  /** The function's inputs that must name the wallet that signs, such as a swap's receiver. */
  readonly walletInputs: readonly string[];
  /**
   * Only a wallet of this role makes this call, such as a launchpad's create call on a registry
   * contract, a launch wallet's alone: only that role's ceiling allows it, and the signer refuses it
   * from any other wallet (decision 0271). A call on a launch's own contracts is a launch wallet's
   * already.
   */
  readonly onlyWallet?: WalletRole;
  /**
   * The venue never builds this call: it declares it, a launch wallet's alone, only so the signer
   * refuses it from every other wallet, such as a launchpad's create overload it never uses. No
   * ceiling lists it, a launch wallet's neither, and custody refuses it (decision 0277).
   */
  readonly isUnbuilt?: boolean;
  /**
   * The call is a bridge deposit and these are the inputs its ceiling rules bind: one rule per
   * destination chain, paying only the addresses saved for that chain (decision 0302). Left out,
   * a plain call.
   */
  readonly bridge?: BridgeCallInputs;
}

/** The contracts a venue touches on one chain, by their names in that chain's registry entry. */
export interface VenueContracts {
  readonly chain: ChainRef;
  /** Contract names the chain registry lists for this venue, such as `router`. */
  readonly names: readonly string[];
  /**
   * The functions the venue's transactions call on this chain. A wallet's ceiling lets it call
   * these and no other function of the venue; left out, none.
   */
  readonly calls?: readonly VenueCall[];
  /**
   * The names among `names` and `launchContracts` a token approval may name as its spender; left
   * out, none.
   */
  readonly spenders?: readonly string[];
  /**
   * By wallet role, the names among `names` only that role's token approval may name as its
   * spender, such as a launchpad's router that pulls a token first buy, a launch wallet's alone:
   * only that role's ceiling allows them, as it alone allows a call marked `onlyWallet` with the
   * role. Each differs from `spenders`; left out, none.
   */
  readonly onlyWalletSpenders?: Readonly<Partial<Record<WalletRole, readonly string[]>>>;
  /**
   * The contracts each launch of the venue has of its own on this chain, by name, such as a
   * launchpad's curve for each token, which no registry can list. The launchpad's curve read
   * names their addresses for a token it holds (`CurveHolding.launch`), found through its own
   * registry contracts; the host lets that token's trades and price reads call them, and nothing
   * else. Each name differs from every one of `names`. Left out, none.
   */
  readonly launchContracts?: readonly string[];
  /**
   * The venue's trade calls on this chain carry no deadline, as a launchpad's curve call may not.
   * The host then accepts a decoded effect without one; its minimum out still binds it. Left out,
   * every trade call must carry a deadline.
   */
  readonly noDeadline?: boolean;
  /**
   * The names among `names` whose own `approve` no ceiling allows and the signer refuses, such as
   * a registry of ERC-721 tokens, whose `approve` shares ERC-20's selector (decision 0304). Left
   * out, none.
   */
  readonly unapproved?: readonly string[];
}

/** What a venue declares about itself: its id and the contracts it touches on each chain. */
export interface VenueDeclaration {
  /** The venue's id, which the chain registry names its contracts after. */
  readonly id: string;
  readonly contracts: readonly VenueContracts[];
}

/** A {@link VenueCall} as a plugin's manifest writes it. */
interface VenueCallWire {
  readonly contract: string;
  readonly abi: JsonValue;
  readonly walletInputs?: readonly string[] | undefined;
  readonly onlyWallet?: WalletRole;
  readonly isUnbuilt?: boolean;
  readonly bridge?: BridgeCallInputs;
}

/** A {@link VenueDeclaration} as a plugin's manifest writes it. */
export interface VenueDeclarationWire {
  readonly id: string;
  readonly contracts: readonly (Omit<VenueContracts, "chain" | "calls"> & {
    readonly chain: string;
    readonly calls?: readonly VenueCallWire[];
  })[];
}

function isUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

// A call the venue never builds is declared for the signer's refusal, so it is a launch wallet's.
const isUnbuiltShaped = (call: VenueCall): boolean =>
  call.isUnbuilt !== true || call.onlyWallet === "launch";

// A bridge deposit's rules reach every wallet's ceiling, so it is no role's alone and is built.
const isBridgeShaped = (call: VenueCall): boolean =>
  call.bridge === undefined || (call.onlyWallet === undefined && call.isUnbuilt !== true);

const callSchema: z.ZodType<VenueCall, VenueCallWire> = z
  .strictObject({
    contract: kebabCaseSchema,
    abi: z.json(),
    walletInputs: z
      .array(z.string().min(1))
      .refine(isUnique, { message: "An input repeats." })
      .default([]),
    onlyWallet: walletRoleSchema.exactOptional(),
    isUnbuilt: z.literal(true).exactOptional(),
    bridge: z
      .strictObject({
        recipient: z.string().min(1),
        destinationChain: z.string().min(1),
        tokenIn: z.string().min(1),
        tokenOut: z.string().min(1),
        minOut: z.string().min(1),
        amountIn: z.string().min(1).exactOptional(),
        emptyInputs: z.array(z.string().min(1)).refine(isUnique),
      })
      .exactOptional(),
  })
  .refine(isUnbuiltShaped, {
    message: "A call the venue never builds is a launch wallet's alone.",
  })
  .refine(isBridgeShaped, {
    message: "A bridge deposit is every wallet's call, and one the venue builds.",
  });

// Every call and every spender names one of the chain's declared contracts, registry or launch,
// a wallet role's spender a registry one, and a spender once; a launch's contract shares no name
// with a registry one.
function namesDeclared(item: Omit<VenueContracts, "chain">): boolean {
  const launch = item.launchContracts ?? [];
  const named = (name: string) => item.names.includes(name) || launch.includes(name);
  const spenders = item.spenders ?? [];
  const launchSpenders = Object.values(item.onlyWalletSpenders ?? {}).flat();
  const calls = item.calls ?? [];
  const isApart = launch.every((name) => !item.names.includes(name));
  return (
    isApart &&
    isUnique([...spenders, ...launchSpenders]) &&
    spenders.every(named) &&
    launchSpenders.every((name) => item.names.includes(name)) &&
    calls.every((call) => named(call.contract)) &&
    unapprovedDeclared(item, spenders)
  );
}

// A chain that marks a call as a bridge wallet's marks every call so and names no spender a main
// wallet approves: only a bridge wallet uses a bridge venue there (decision 0307).
function isBridgeAlone(item: Omit<VenueContracts, "chain">): boolean {
  const calls = item.calls ?? [];
  const marked = calls.filter((call) => call.onlyWallet === "bridge");
  return (
    marked.length === 0 || (marked.length === calls.length && (item.spenders ?? []).length === 0)
  );
}

// A contract whose `approve` is refused is a registry one, and no spender (decision 0304).
function unapprovedDeclared(
  item: Omit<VenueContracts, "chain">,
  spenders: readonly string[],
): boolean {
  return (item.unapproved ?? []).every(
    (name) => item.names.includes(name) && !spenders.includes(name),
  );
}

/**
 * Checks a venue's declaration: a kebab-case id of at most 32 characters, at least one chain, each
 * chain once, and at least one contract name on each, each name once. A launch's contracts have
 * names of their own, each once. A call or a spender names one of the chain's contracts, registry
 * or launch, each spender once. A chain that marks a call as a bridge wallet's marks every call so
 * and names no spender a main wallet approves (decision 0307).
 */
export const venueDeclarationSchema: z.ZodType<VenueDeclaration, VenueDeclarationWire> = z.object({
  id: kebabCaseSchema.max(32),
  contracts: z
    .array(
      z
        .strictObject({
          chain: chainRefSchema,
          names: z.array(kebabCaseSchema).min(1).refine(isUnique, { message: "A name repeats." }),
          calls: z.array(callSchema).exactOptional(),
          spenders: z.array(kebabCaseSchema).exactOptional(),
          onlyWalletSpenders: z
            .strictObject({
              launch: z.array(kebabCaseSchema).exactOptional(),
              bridge: z.array(kebabCaseSchema).exactOptional(),
            })
            .exactOptional(),
          launchContracts: z
            .array(kebabCaseSchema)
            .min(1)
            .refine(isUnique, { message: "A launch's contract name repeats." })
            .exactOptional(),
          noDeadline: z.boolean().exactOptional(),
          unapproved: z.array(kebabCaseSchema).exactOptional(),
        })
        .refine(namesDeclared, { message: "A call or a spender names no declared contract." })
        .refine(isBridgeAlone, {
          message:
            "A chain that marks a bridge wallet's call marks every call so, with no spender.",
        }),
    )
    .min(1)
    .refine((items: readonly VenueContracts[]) => isUnique(items.map((item) => item.chain)), {
      message: "A chain repeats.",
    }),
});

/**
 * A venue: a protocol the agent trades on, such as a DEX router. It declares the contracts it
 * touches, quotes, builds the transactions of a trade, and decodes them. Only reviewed venues run
 * in the engine, and the venue host checks every transaction they build. A launchpad also reads
 * its curve, so the engine sends a token still on it there and nowhere else. A venue that holds
 * the state a token's price comes from, such as a launchpad's curve, declares the reads that price
 * it, which the price watcher asks every block. A launchpad whose contracts favor some wallets on
 * a token it launched names them, for the risk step. A launchpad that launches tokens for the
 * agent holds its `launcher`, and one whose launches the launch feed records declares its
 * `launchEvents` and reads them.
 */
export interface Venue
  extends
    VenueDeclaration,
    Quoter,
    TxBuilder,
    TxDecoder,
    Partial<CurveReader>,
    Partial<PriceReader>,
    Partial<InsiderReader>,
    Partial<LaunchReader> {
  readonly launcher?: Launcher;
}

/** A launchpad: a venue that trades the tokens on its bonding curve, and says which those are. */
export interface LaunchpadVenue extends Omit<Venue, "curve">, CurveReader {}
