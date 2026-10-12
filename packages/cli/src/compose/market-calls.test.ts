import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Skeleton,
  skeletonCompositions as compositions,
  skeletonSecrets,
  startSkeleton,
} from "./test-skeleton.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const chain = chainRefSchema.parse("fake:1");
const token = assetRefSchema.parse("fake:1/token:0x0000000a");

describe.each(compositions)(
  "market reads through every layer on the $name composition",
  ({ parts }) => {
    let skeleton: Skeleton | undefined;

    afterEach(async () => {
      await skeleton?.close();
      skeleton = undefined;
    });

    it("answers an MCP client's scan and chart from the profile's market reads", async () => {
      skeleton = await startSkeleton(parts());
      const mcp = await skeleton.connect(skeletonSecrets.mcp, "mcp");
      const trending = { chain, source: "trending" } as const;
      await expect(mcp.call("market/scan", trending, live())).rejects.toMatchObject({
        code: "market.no_data",
        retryable: false,
      });
      const chart = { asset: token, interval: "1h" } as const;
      await expect(mcp.call("market/chart", chart, live())).rejects.toMatchObject({
        code: "market.no_data",
      });
      const launches = { chain, source: "launches" } as const;
      await expect(mcp.call("market/scan", launches, live())).rejects.toMatchObject({
        code: "market.no_launch_feed",
      });
    });
  },
);
