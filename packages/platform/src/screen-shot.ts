/** A screenshot the OS took, as PNG, or as JPEG when the PNG was over the byte limit. */
export interface ScreenShot {
  readonly bytes: Uint8Array;
  readonly contentType: "image/png" | "image/jpeg";
  /** The display it shows, by the OS's number from 1; absent for one image of every display. */
  readonly display?: number;
}

/**
 * Why no screenshot was taken (decision 0406): the machine shows no screen, such as a server or a
 * container; no screenshot program binference runs is installed; the OS has not allowed the
 * capture's `program` to record the screen; no display has the number asked, or the program
 * cannot pick one; the shot stays over the byte limit; or the program failed or ran past its
 * limit.
 */
export type ScreenRefusal =
  | "no_screen"
  | "no_program"
  | "no_permission"
  | "no_display"
  | "too_large"
  | "failed";
