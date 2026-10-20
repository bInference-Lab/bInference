import type { Launcher } from "../venues/ports.js";
import { createFakeLinkLauncher, type FakeLauncherOptions } from "./fake-launcher.js";

/**
 * Creates the launcher of a fake launchpad that writes the owner's picture into its create call
 * (decision 0279): it takes a picture of at most `mostBytes` beside any words, uploads nothing and
 * has no pin, and launches as {@link createFakeLinkLauncher} does, its create call naming the
 * picture by its type and digest.
 */
export function createFakePictureLauncher(
  options: FakeLauncherOptions & { readonly mostBytes: number },
): Launcher {
  return { ...createFakeLinkLauncher(options), pictureBytesFor: () => options.mostBytes };
}
