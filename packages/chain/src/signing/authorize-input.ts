import { type Id, idSchema, type JsonValue } from "@binference/core";
import { z } from "zod";
import { type AccountRef, accountRefSchema } from "../caip/account-ref.js";
import { type PrivyRequest, privyRequestSchema } from "./privy-request.js";
import {
  type SignAuthorization,
  signAuthorizationSchema,
  type SignAuthorizationWire,
  termsHashSchema,
} from "./sign-authorization.js";
import { type SignStep, signStepSchema, type SignStepWire } from "./sign-step.js";
import { type WalletRole, walletRoleSchema } from "./wallet-role.js";

/** The agent wallet a signature is for. */
export interface SignerWallet {
  readonly id: Id<"wal">;
  /** The wallet's id at Privy: the `<id>` of `/v1/wallets/<id>/rpc`. */
  readonly custodyId: string;
  /** The wallet's own account on the step's chain. */
  readonly account: AccountRef;
  /**
   * `launch` for the agent's launch wallet, the one wallet a call to a launch contract or an
   * approval naming one may come from (decision 0217); absent for an agent wallet.
   */
  readonly role?: WalletRole;
}

/** A call only a wallet of one role makes, such as a launchpad's create call (decision 0271). */
export interface WalletOnlyCall {
  readonly role: WalletRole;
  /** The function as its JSON ABI entry. */
  readonly abi: JsonValue;
}

/**
 * A function a venue declares on one of its contracts (decision 0302): a contract the step's venues
 * declare functions on takes a call to no other.
 */
export interface DeclaredCall {
  /** The contract; absent for a call on the contracts of the launch the step trades on. */
  readonly contract?: AccountRef;
  /** The function as its JSON ABI entry. */
  readonly abi: JsonValue;
}

/** A spender only a wallet of one role may approve, such as a bridge wallet's depository. */
export interface WalletOnlySpender {
  readonly role: WalletRole;
  readonly spender: AccountRef;
}

/**
 * What one call's top-level inputs must be, which the signer reads from its calldata (decision
 * 0302): it applies to a call with the function's selector.
 */
export interface CallInputCheck {
  /** The function as its JSON ABI entry. */
  readonly abi: JsonValue;
  /** Address inputs that must name the signing wallet, such as a swap's receiver. */
  readonly wallet: readonly string[];
  /** Inputs that must equal these: an address as hex in any case, a number in decimal. */
  readonly equal: Readonly<Record<string, string>>;
  /** `bytes` inputs that must be empty, such as a bridge deposit's message. */
  readonly empty: readonly string[];
  /** Number inputs that must be at least these, in decimal, such as a deposit's output. */
  readonly atLeast: Readonly<Record<string, string>>;
  /**
   * The inputs of a bridge deposit that name its recipient, its destination chain, the token that
   * leaves, the token that arrives, the amount sent when the venue names it, and the output a fill
   * pays at least: the signer refuses the call unless `equal` names every one but the last, from
   * the confirmed plan, and `atLeast` names the last (decision 0317). Absent for any other call.
   */
  readonly bridge?: {
    readonly recipient: string;
    readonly destinationChain: string;
    readonly tokenIn: string;
    readonly tokenOut: string;
    readonly amountIn?: string;
    readonly minOut: string;
  };
}

/**
 * The registry's set for one step (keys spec, section 5.2, rule 2): the venue's declared
 * contracts a call may go to, the registry spenders an approval may name, the confirmed
 * recipient of a send, a bridge or a rescue, and the contracts of the launch the step trades on,
 * which a launch wallet alone may call and approve (decision 0217).
 */
export interface AllowedTargets {
  readonly contracts: readonly AccountRef[];
  readonly spenders: readonly AccountRef[];
  readonly recipients: readonly AccountRef[];
  /** The launch's own contracts, read from its launchpad right before signing; none when absent. */
  readonly launch?: readonly AccountRef[];
  /**
   * The calls only a wallet of one role makes on the step's venues, such as a launchpad's create
   * call, a launch wallet's alone (decision 0271): the signer refuses one from a wallet of any
   * other role. None when absent.
   */
  readonly walletOnlyCalls?: readonly WalletOnlyCall[];
  /**
   * Contracts an approval is never sent to, such as an ERC-8004 registry whose ERC-721 `approve`
   * shares ERC-20's selector (decision 0304): the signer refuses an `approve` to one. None when
   * absent.
   */
  readonly unapproved?: readonly AccountRef[];
  /**
   * What the inputs of the step's calls must be: the inputs a venue pins to the wallet and the
   * inputs that must be empty, from its declaration, and a bridge deposit's recipient, chain and
   * least output from the confirmed plan. None when absent.
   */
  readonly callInputs?: readonly CallInputCheck[];
  /**
   * The functions the step's venues declare on their contracts: the signer refuses a call to a
   * contract that has declared functions unless it calls one of them. None when absent.
   */
  readonly calls?: readonly DeclaredCall[];
  /**
   * The spenders only a wallet of one role may approve: the signer refuses an approval naming one
   * from a wallet of any other role. None when absent.
   */
  readonly walletOnlySpenders?: readonly WalletOnlySpender[];
}

/**
 * The signer's `authorize` request (keys spec, section 5.1): the Privy request custody built for
 * one transaction, the wallet it signs for, and from the engine's `SignRequest` the intent
 * and step it belongs to, what approved the intent, the terms hash of what was approved and the
 * registry's set for the step. The signer's hard rules (section 5.2) read every field.
 */
export interface AuthorizeInput {
  readonly wallet: SignerWallet;
  readonly request: PrivyRequest;
  readonly intent: Id<"int">;
  readonly step: SignStep;
  readonly authorization: SignAuthorization;
  readonly termsHash: string;
  readonly allowed: AllowedTargets;
}

/** An {@link AuthorizeInput} as JSON carries it. */
export interface AuthorizeInputWire {
  readonly wallet: {
    readonly id: string;
    readonly custodyId: string;
    readonly account: string;
    readonly role?: WalletRole;
  };
  readonly request: PrivyRequest;
  readonly intent: string;
  readonly step: SignStepWire;
  readonly authorization: SignAuthorizationWire;
  readonly termsHash: string;
  readonly allowed: {
    readonly contracts: readonly string[];
    readonly spenders: readonly string[];
    readonly recipients: readonly string[];
    readonly launch?: readonly string[];
    readonly walletOnlyCalls?: readonly WalletOnlyCall[];
    readonly unapproved?: readonly string[];
    readonly callInputs?: readonly CallInputCheck[];
    readonly calls?: readonly { readonly contract?: string; readonly abi: JsonValue }[];
    readonly walletOnlySpenders?: readonly {
      readonly role: WalletRole;
      readonly spender: string;
    }[];
  };
}

const inputName = z.string().regex(/^[A-Za-z_$][\w$]{0,63}$/);
const callInputCheckSchema: z.ZodType<CallInputCheck, CallInputCheck> = z.strictObject({
  abi: z.json(),
  wallet: z.array(inputName).max(16),
  equal: z.record(inputName, z.string().regex(/^(?:0x[0-9a-fA-F]{40}|\d{1,78})$/)),
  empty: z.array(inputName).max(16),
  atLeast: z.record(inputName, z.string().regex(/^\d{1,78}$/)),
  bridge: z
    .strictObject({
      recipient: inputName,
      destinationChain: inputName,
      tokenIn: inputName,
      tokenOut: inputName,
      amountIn: inputName.exactOptional(),
      minOut: inputName,
    })
    .exactOptional(),
});

// The registry's sets are small; a longer list is a fault on the engine's side.
const targetsSchema = z.array(accountRefSchema).max(256);

/** Decodes an {@link AuthorizeInput} from JSON, and encodes it back with `z.encode`. */
export const authorizeInputSchema: z.ZodType<AuthorizeInput, AuthorizeInputWire> = z.strictObject({
  wallet: z.strictObject({
    id: idSchema("wal"),
    custodyId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    account: accountRefSchema,
    role: walletRoleSchema.exactOptional(),
  }),
  request: privyRequestSchema,
  intent: idSchema("int"),
  step: signStepSchema,
  authorization: signAuthorizationSchema,
  termsHash: termsHashSchema,
  allowed: z.strictObject({
    contracts: targetsSchema,
    spenders: targetsSchema,
    recipients: targetsSchema,
    launch: targetsSchema.exactOptional(),
    walletOnlyCalls: z
      .array(z.strictObject({ role: walletRoleSchema, abi: z.json() }))
      .max(64)
      .exactOptional(),
    unapproved: targetsSchema.exactOptional(),
    callInputs: z.array(callInputCheckSchema).max(64).exactOptional(),
    calls: z
      .array(z.strictObject({ contract: accountRefSchema.exactOptional(), abi: z.json() }))
      .max(256)
      .exactOptional(),
    walletOnlySpenders: z
      .array(z.strictObject({ role: walletRoleSchema, spender: accountRefSchema }))
      .max(64)
      .exactOptional(),
  }),
});
