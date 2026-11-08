import { join } from "node:path";
import type { ScreenCapture } from "../ports.js";
import {
  inWorkFolder,
  type ScreenCaptureParts,
  type ShotStep,
  takeWholeShot,
  type WholeShot,
} from "../screen-shots.js";

// The exit code the script ends with when no display has the number asked.
const noDisplayExit = 3;

// A fixed Windows PowerShell script that copies the screen into a bitmap through .NET's
// System.Windows.Forms and System.Drawing: every display (the virtual screen), or the display
// SCREEN_DISPLAY numbers from 1. It saves PNG, or JPEG at quality 70 when SCREEN_FORMAT says,
// scaled to at most SCREEN_EDGE pixels on its longer side when set, to SCREEN_FILE. Every input
// arrives as a variable of its own process, so nothing of a request is read as a script.
const script = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.Windows.Forms, System.Drawing",
  `Add-Type -Name Dpi -Namespace Screen -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'`,
  "[void][Screen.Dpi]::SetProcessDPIAware()",
  "$screens = [System.Windows.Forms.Screen]::AllScreens",
  "if ($env:SCREEN_DISPLAY) {",
  "  $n = [int]$env:SCREEN_DISPLAY",
  `  if ($n -lt 1 -or $n -gt $screens.Length) { exit ${String(noDisplayExit)} }`,
  "  $area = $screens[$n - 1].Bounds",
  "} else { $area = [System.Windows.Forms.SystemInformation]::VirtualScreen }",
  "$shot = New-Object System.Drawing.Bitmap $area.Width, $area.Height",
  "$graphics = [System.Drawing.Graphics]::FromImage($shot)",
  "$graphics.CopyFromScreen($area.Left, $area.Top, 0, 0, $shot.Size)",
  "$graphics.Dispose()",
  "if ($env:SCREEN_EDGE) {",
  "  $edge = [double]$env:SCREEN_EDGE",
  "  $scale = [Math]::Min(1.0, $edge / [Math]::Max($shot.Width, $shot.Height))",
  "  $smaller = New-Object System.Drawing.Bitmap $shot, ([int]($shot.Width * $scale)), ([int]($shot.Height * $scale))",
  "  $shot.Dispose(); $shot = $smaller",
  "}",
  "if ($env:SCREEN_FORMAT -eq 'jpeg') {",
  "  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }",
  "  $options = New-Object System.Drawing.Imaging.EncoderParameters 1",
  "  $options.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 70L",
  "  $shot.Save($env:SCREEN_FILE, $codec, $options)",
  "} else { $shot.Save($env:SCREEN_FILE, [System.Drawing.Imaging.ImageFormat]::Png) }",
  "$shot.Dispose()",
].join("\r\n");

/** Windows PowerShell's `-EncodedCommand` takes the Base64 of a script's UTF-16 little endian text. */
const encoded = Buffer.from(script, "utf16le").toString("base64");

const powershell = ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded];

// One run of the script that writes `out`, as PNG, JPEG, or JPEG at most 2,560 pixels a side.
function stepOf(out: string, display: number | undefined, form: "png" | "jpeg" | "fit"): ShotStep {
  const env = {
    SCREEN_FILE: out,
    ...(display === undefined ? {} : { SCREEN_DISPLAY: String(display) }),
    ...(form === "png" ? {} : { SCREEN_FORMAT: "jpeg" }),
    ...(form === "fit" ? { SCREEN_EDGE: "2560" } : {}),
  };
  const contentType = form === "png" ? "image/png" : "image/jpeg";
  return { file: "powershell.exe", args: powershell, env, out, contentType };
}

// The script's runs for one shot: PNG, then JPEG, then smaller JPEG. Its own exit code says a
// display is not there.
function wholeShotOf(folder: string, display: number | undefined): WholeShot {
  return {
    first: stepOf(join(folder, "screen.png"), display, "png"),
    smaller: [
      stepOf(join(folder, "screen.jpg"), display, "jpeg"),
      stepOf(join(folder, "screen-fit.jpg"), display, "fit"),
    ],
    display,
    failure: (exit) => (exit.exitCode === noDisplayExit ? "no_display" : "failed"),
  };
}

/**
 * The screen on Windows (decision 0406): a fixed Windows PowerShell script copies every display,
 * or the one asked, through .NET's System.Windows.Forms and System.Drawing, aware of the display's
 * scaling, into a PNG; a shot over the limit is taken again as JPEG, then smaller. Its inputs are
 * variables of its own process, never a script built from them.
 */
export function createWin32ScreenCapture(parts: ScreenCaptureParts): ScreenCapture {
  return {
    program: parts.program,
    capture: async (request, { signal }) =>
      inWorkFolder(parts, signal, async (folder) =>
        takeWholeShot(parts, wholeShotOf(folder, request.display), signal),
      ),
  };
}
