import {
  type AccountRef,
  type ChainRef,
  accountRefSchema,
  chainRefSchema,
} from "@binference/chain";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import type { AgentArgs } from "../values/agent-args.schema.js";
import { type Empty, emptyResultSchema } from "../values/empty.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { labelSchema } from "../values/label.schema.js";
import { ownerKeyCodeSchema } from "../values/owner-key-code.schema.js";
import { type Page, pageSchema } from "../values/page.schema.js";
import { plainIdSchema } from "../values/plain-id.schema.js";
import {
  type CeilingChanges,
  ceilingChangesSchema,
  type CeilingView,
  ceilingViewSchema,
} from "../views/ceiling-view.schema.js";
import { type WalletView, walletViewSchema } from "../views/wallet-view.schema.js";
import { localWriteFlags, readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

/** The args of an operation on one wallet. */
interface WalletArgs {
  readonly wallet: ProtocolId<"wallet">;
}

/** The args of `wallet/create`: a new Privy wallet, owned by the owner key. */
interface CreateWalletArgs extends AgentArgs {
  readonly label: string;
  readonly ownerKey: string;
}

/** The args of `wallet/rename`. */
interface RenameWalletArgs extends WalletArgs {
  readonly label: string;
}

/** The args of `wallet/exportKey`. */
interface ExportKeyArgs extends WalletArgs {
  readonly ownerKey: string;
}

/** The args of `ceiling/set`. */
interface SetCeilingArgs extends WalletArgs {
  readonly changes: CeilingChanges;
  readonly ownerKey: string;
}

/** The args of `signer/revoke`: a machine's agent key, removed from every wallet. */
interface RevokeSignerArgs {
  readonly signer: string;
  readonly ownerKey: string;
}

/** A saved address: usable for sends from `usableAt`. */
interface AddressEntryView {
  readonly entry: ProtocolId<"addressBook">;
  readonly agent: ProtocolId<"agent">;
  readonly address: AccountRef;
  readonly label: string;
  readonly usableAt: number;
  /** When the owner key saved the address in the ceiling. */
  readonly inCeilingAt?: number;
  readonly createdAt: number;
}

/** The args of `address/add`: saved in the address book and in the ceiling, with the owner key. */
interface AddAddressArgs extends AgentArgs {
  readonly chain: ChainRef;
  /** The address as the chain's family writes it. */
  readonly address: string;
  readonly label: string;
  readonly ownerKey: string;
}

/**
 * The operations on wallets and what their Privy policy holds: the ceiling, signer keys and saved
 * addresses (protocol spec sections 7.2 and 7.6).
 */
export interface WalletOperationShapes {
  readonly "wallet/list": {
    readonly args: { readonly agent?: ProtocolId<"agent"> };
    readonly result: Page<WalletView>;
  };
  readonly "wallet/create": { readonly args: CreateWalletArgs; readonly result: WalletView };
  readonly "wallet/rename": { readonly args: RenameWalletArgs; readonly result: WalletView };
  readonly "wallet/exportKey": {
    readonly args: ExportKeyArgs;
    /** Privy's export of the key, which the CLI decrypts. */
    readonly result: { readonly privateKey: string };
  };
  readonly "ceiling/get": { readonly args: WalletArgs; readonly result: CeilingView };
  readonly "ceiling/set": { readonly args: SetCeilingArgs; readonly result: CeilingView };
  readonly "signer/revoke": { readonly args: RevokeSignerArgs; readonly result: Empty };
  readonly "address/list": { readonly args: AgentArgs; readonly result: Page<AddressEntryView> };
  readonly "address/add": { readonly args: AddAddressArgs; readonly result: AddressEntryView };
  readonly "address/remove": {
    readonly args: { readonly entry: ProtocolId<"addressBook"> };
    readonly result: Empty;
  };
}

const agent = protocolIdSchema("agent");
const wallet = protocolIdSchema("wallet");
const entry = protocolIdSchema("addressBook");
const addressEntryView = z.object({
  entry,
  agent,
  address: accountRefSchema,
  label: z.string(),
  usableAt: epochMsSchema,
  inCeilingAt: epochMsSchema.exactOptional(),
  createdAt: epochMsSchema,
});

/** The wallet, ceiling, signer and address book operations, by name. */
export const walletOperations: OperationTable<WalletOperationShapes> = {
  "wallet/list": {
    ...readFlags,
    name: "wallet/list",
    scope: "read",
    args: z.strictObject({ agent: agent.exactOptional() }),
    result: pageSchema(walletViewSchema),
  },
  "wallet/create": {
    ...localWriteFlags,
    name: "wallet/create",
    scope: "admin",
    args: z.strictObject({ agent, label: labelSchema, ownerKey: ownerKeyCodeSchema }),
    result: walletViewSchema,
  },
  "wallet/rename": {
    ...writeFlags,
    name: "wallet/rename",
    scope: "admin",
    args: z.strictObject({ wallet, label: labelSchema }),
    result: walletViewSchema,
  },
  "wallet/exportKey": {
    ...localWriteFlags,
    name: "wallet/exportKey",
    scope: "admin",
    args: z.strictObject({ wallet, ownerKey: ownerKeyCodeSchema }),
    result: z.object({ privateKey: z.string().min(1) }),
  },
  "ceiling/get": {
    ...readFlags,
    name: "ceiling/get",
    scope: "read",
    args: z.strictObject({ wallet }),
    result: ceilingViewSchema,
  },
  "ceiling/set": {
    ...localWriteFlags,
    name: "ceiling/set",
    scope: "admin",
    args: z.strictObject({ wallet, changes: ceilingChangesSchema, ownerKey: ownerKeyCodeSchema }),
    result: ceilingViewSchema,
  },
  "signer/revoke": {
    ...localWriteFlags,
    name: "signer/revoke",
    scope: "admin",
    args: z.strictObject({ signer: plainIdSchema, ownerKey: ownerKeyCodeSchema }),
    result: emptyResultSchema,
  },
  "address/list": {
    ...readFlags,
    name: "address/list",
    scope: "read",
    args: z.strictObject({ agent }),
    result: pageSchema(addressEntryView),
  },
  "address/add": {
    ...localWriteFlags,
    name: "address/add",
    scope: "admin",
    args: z.strictObject({
      agent,
      chain: chainRefSchema,
      address: z.string().regex(/^[-.%a-zA-Z0-9]{1,128}$/),
      label: labelSchema,
      ownerKey: ownerKeyCodeSchema,
    }),
    result: addressEntryView,
  },
  "address/remove": {
    ...writeFlags,
    name: "address/remove",
    scope: "confirm",
    args: z.strictObject({ entry }),
    result: emptyResultSchema,
  },
};
