import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  decodeServiceAnswer,
  decodeServiceRequest,
  signerServiceAnswerSchema,
  signerServiceRequestSchema,
} from "./signer-service-wire.schema.js";

// The request and the `over_sums` answer spec 5, section 8.3 shows.
const specRequest = {
  version: 1,
  requestId: "0190f1c2-3a4b-7c5d-8e6f-000000000001",
  install: "ins_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  fence: 7,
  intent: "int_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  step: 0,
  authorization: { kind: "confirmation", id: "cnf_0190f1c2-3a4b-7c5d-8e6f-000000000001" },
  nonce: 41,
  gasLimit: "180000",
  fees: { gasPrice: "1000000000" },
  replaces: "speedUp",
};
const specOverSums = {
  version: 1,
  requestId: "0190f1c2-3a4b-7c5d-8e6f-000000000001",
  outcome: "over_sums",
  chain: "eip155:56",
  asset: "eip155:56/slip44:714",
  capBase: "10000000000000000000",
  usedBase: "9500000000000000000",
  askedBase: "1000000000000000000",
  roomAtMs: 1767225600000,
};
const header = { version: 1, requestId: specRequest.requestId };

describe("the signer service's wire", () => {
  it("reads the spec's request and writes it back to the same JSON", () => {
    const request = decodeServiceRequest(JSON.stringify(specRequest));
    expect(request).toMatchObject({ gasLimit: 180_000n, fees: { gasPrice: 10n ** 9n } });
    expect(
      z.encode(signerServiceRequestSchema, signerServiceRequestSchema.parse(specRequest)),
    ).toEqual(specRequest);
  });

  it("reads every outcome the spec lists, and the spec's over_sums answer", () => {
    const answers = [
      {
        ...header,
        outcome: "signed",
        tx: { chain: "eip155:56", raw: "0x02ab", hash: `0x${"ab".repeat(32)}` },
      },
      { ...header, outcome: "refused", reason: "nonce_held" },
      specOverSums,
      { ...header, outcome: "locked", reason: "privy_app" },
      { ...header, outcome: "lease_lost" },
      { ...header, outcome: "down", reason: "kms" },
    ];
    for (const answer of answers) {
      expect(z.encode(signerServiceAnswerSchema, signerServiceAnswerSchema.parse(answer))).toEqual(
        answer,
      );
    }
    expect(decodeServiceAnswer(JSON.stringify(specOverSums))).toMatchObject({
      capBase: 10n ** 19n,
    });
  });

  it("refuses a field no version names, another version and text that is no JSON", () => {
    expect(
      decodeServiceRequest(JSON.stringify({ ...specRequest, termsHash: "00" })),
    ).toBeUndefined();
    expect(decodeServiceRequest(JSON.stringify({ ...specRequest, version: 2 }))).toBeUndefined();
    expect(decodeServiceAnswer(JSON.stringify({ ...specOverSums, note: "more" }))).toBeUndefined();
    expect(
      decodeServiceAnswer(JSON.stringify({ ...header, outcome: "refused", reason: "rule_7" })),
    ).toBeUndefined();
    expect(decodeServiceAnswer("signed")).toBeUndefined();
  });
});
