import type { CredentialOperationShapes } from "../operations/credential-operations.schema.js";
import { at, ids, type WireExample } from "./wire-values.js";

const request = "crq_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const view = {
  request,
  agent: ids.agent,
  session: ids.session,
  turn: ids.turn,
  name: "DUNE_API_KEY",
  reason: "To read the token's holder history from Dune.",
  allowedHosts: ["api.dune.com"],
  createdAt: at,
  closesAt: at + 900_000,
};
const turn = { session: ids.session, turn: ids.turn };

/** Example calls of the operations of the owner's stored credentials (decision 0388). */
export const credentialExamples: {
  readonly [N in keyof CredentialOperationShapes]: WireExample;
} = {
  "turn/credential": {
    args: {
      agent: ids.agent,
      session: ids.session,
      turn: ids.turn,
      name: "DUNE_API_KEY",
      reason: "To read the token's holder history from Dune.",
      allowedHosts: ["api.dune.com"],
    },
    result: view,
  },
  "credential/answer": {
    args: {
      agent: ids.agent,
      request,
      value: "example-value",
      allowedHosts: ["api.dune.com"],
    },
    result: turn,
  },
  "credential/skip": { args: { agent: ids.agent, request }, result: turn },
  "chat/openCredentialRequest": {
    args: { agent: ids.agent },
    result: { request: view },
  },
  "credential/list": {
    args: {},
    result: {
      items: [{ name: "DUNE_API_KEY", allowedHosts: ["api.dune.com"], updatedAt: at }],
    },
  },
  "credential/delete": {
    args: { name: "DUNE_API_KEY" },
    result: { name: "DUNE_API_KEY" },
  },
  "credential/set": {
    args: {
      name: "DUNE_API_KEY",
      value: "example-value",
      allowedHosts: ["api.dune.com"],
    },
    result: {
      name: "DUNE_API_KEY",
      allowedHosts: ["api.dune.com"],
      updatedAt: at,
    },
  },
};
