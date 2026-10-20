import type { Venue } from "@binference/chain";
import {
  createFakeLaunchpad,
  createFakePictureLauncher,
  fakeLaunchCallAbi,
} from "@binference/chain/testing";

/**
 * A fake venue that only launches tokens (decision 0282), as `fake-curve`: a launcher that writes
 * the picture into its create call, no curve, and one call, a launch wallet's alone.
 */
export function testLaunchesOnlyVenue(): Venue {
  const launcher = createFakePictureLauncher({ mostBytes: 1_000 });
  const { curve: _curve, ...pad } = createFakeLaunchpad({ onCurve: [], launcher });
  return {
    ...pad,
    contracts: pad.contracts.map((item) => ({
      chain: item.chain,
      names: item.names,
      calls: [
        { contract: "router", abi: fakeLaunchCallAbi, walletInputs: [], isLaunchWalletOnly: true },
      ],
    })),
  };
}
