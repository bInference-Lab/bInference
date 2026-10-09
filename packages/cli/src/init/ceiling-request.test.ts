import { createScriptedHttp } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { coreVenues } from "./ceiling-request.js";

const http = createScriptedHttp([]);
const okxKeys = {
  apiKey: { fromKeychain: "okx-api-key" },
  secret: { fromKeychain: "okx-secret" },
  passphrase: { fromKeychain: "okx-passphrase" },
};

describe("core venues", () => {
  it("installs KyberSwap alone while no OKX key is set", () => {
    const venues = coreVenues(http, { keys: {}, kyberClientId: "binference" });
    expect(venues.map((venue) => venue.id)).toStrictEqual(["kyberswap"]);
  });

  it("installs OKX with its router and TokenApprove once the owner sets its key", () => {
    const venues = coreVenues(http, { keys: { okx: okxKeys }, kyberClientId: "binference" });
    expect(venues.map((venue) => [venue.id, venue.contracts])).toStrictEqual([
      [
        "kyberswap",
        [
          {
            chain: "eip155:56",
            names: ["meta-aggregation-router-v2", "aggregation-executor-proxy"],
          },
        ],
      ],
      ["okx", [{ chain: "eip155:56", names: ["dex-router", "token-approve"] }]],
    ]);
  });
});
