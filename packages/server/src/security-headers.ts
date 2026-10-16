function isMiniPath(path: string): boolean {
  return path === "/mini" || path.startsWith("/mini/");
}

// Every browser feature a policy can gate that the console never uses, each turned off for the
// page and every frame it could hold; only names Chromium knows, as it logs an error for any
// other. Notifications are no such feature: the owner allows them.
const unusedFeatures = [
  "accelerometer",
  "autoplay",
  "bluetooth",
  "browsing-topics",
  "camera",
  "clipboard-read",
  "display-capture",
  "encrypted-media",
  "fullscreen",
  "geolocation",
  "gyroscope",
  "hid",
  "idle-detection",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "picture-in-picture",
  "publickey-credentials-create",
  "publickey-credentials-get",
  "screen-wake-lock",
  "serial",
  "usb",
  "xr-spatial-tracking",
];

const permissionsPolicy = unusedFeatures.map((feature) => `${feature}=()`).join(", ");

/** The headers every answer of the HTTP listener carries: no sniffing, no referrer, no features. */
const everyAnswer: Readonly<Record<string, string>> = {
  "referrer-policy": "no-referrer",
  "permissions-policy": permissionsPolicy,
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
};

/**
 * The headers of an answer no page runs in, such as a script, an image, an error or JSON: a
 * policy that loads nothing and may not be framed, so a file opened on its own, such as an SVG,
 * runs no script.
 */
export const resourceHeaders: Readonly<Record<string, string>> = {
  ...everyAnswer,
  "content-security-policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-frame-options": "DENY",
};

/**
 * The headers of the console's page. It loads only its own files and talks only to its own
 * origin, and no inline style or script runs. Telegram shows the Mini App in a frame, so only
 * `/mini` may be framed, and only by Telegram's web client.
 */
export function pageHeaders(path: string): Record<string, string> {
  const isMini = isMiniPath(path);
  const frames = isMini ? "https://web.telegram.org" : "'none'";
  return {
    ...everyAnswer,
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      // `blob:` shows the previews of the images the owner picks before they upload.
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      `frame-ancestors ${frames}`,
    ].join("; "),
    "cross-origin-opener-policy": "same-origin",
    ...(isMini ? {} : { "x-frame-options": "DENY" }),
  };
}
