/** A screenshot of the owner's screen, as PNG or as JPEG, which the engine saves for the agent. */
export interface ScreenShot {
  readonly bytes: Readonly<Uint8Array>;
  readonly contentType: "image/png" | "image/jpeg";
  /** The display it shows, by the OS's number from 1; absent for one image of every display. */
  readonly display?: number;
}

/**
 * Why no screenshot was taken (decision 0406): the machine shows no screen; no screenshot program
 * binference runs is installed; the OS has not allowed binference to record the screen; no display
 * has the number asked; the shot stays over 5 MiB; or the program failed.
 */
export type ScreenRefusal =
  | "no_screen"
  | "no_program"
  | "no_permission"
  | "no_display"
  | "too_large"
  | "failed";
