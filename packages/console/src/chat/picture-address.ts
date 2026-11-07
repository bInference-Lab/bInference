import { useEffect, useMemo } from "react";
import type { DraftPicture } from "./draft-picture";

/**
 * A picture as an address the page made from its bytes alone, let go when it changes or the
 * component leaves; none without a picture.
 */
export function usePictureAddress(picture: DraftPicture | undefined): string | undefined {
  const address = useMemo(
    () =>
      picture === undefined
        ? undefined
        : URL.createObjectURL(new Blob([picture.bytes], { type: picture.contentType })),
    [picture],
  );
  useEffect(
    () => () => {
      if (address !== undefined) {
        URL.revokeObjectURL(address);
      }
    },
    [address],
  );
  return address;
}
