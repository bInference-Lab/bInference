import type { IncomingMessage, ServerResponse } from "node:http";
import { extname } from "node:path";

/**
 * The console's built files by their path under the build folder, such as `index.html` and
 * `assets/index-1a2b3c.js`, read once when the engine starts.
 */
export type ConsoleFiles = ReadonlyMap<string, Uint8Array>;

const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

function isMiniPath(path: string): boolean {
  return path === "/mini" || path.startsWith("/mini/");
}

// The page loads only its own files and talks only to its own origin. Telegram shows the Mini
// App in a frame, so only `/mini` may be framed, and only by Telegram's web client.
function securityHeaders(path: string): Record<string, string> {
  const isMini = isMiniPath(path);
  const frames = isMini ? "https://web.telegram.org" : "'none'";
  return {
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      `frame-ancestors ${frames}`,
    ].join("; "),
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "cross-origin-opener-policy": "same-origin",
    ...(isMini ? {} : { "x-frame-options": "DENY" }),
  };
}

// A path whose last part has no extension is a page of the console: its routes all load the
// same page, which picks the screen from the address.
function isPagePath(path: string): boolean {
  return extname(path) === "";
}

// The file a path names, or `undefined` for a path that does not decode.
function fileOf(path: string): string | undefined {
  if (isPagePath(path)) {
    return "index.html";
  }
  try {
    return decodeURIComponent(path.slice(1));
  } catch {
    return undefined;
  }
}

function cacheOf(file: string): string {
  return file.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache";
}

function send(response: ServerResponse, request: IncomingMessage, body: Uint8Array): void {
  response.end(request.method === "HEAD" ? undefined : body);
}

/**
 * Answers a `GET` or `HEAD` for the console: `/`, `/mini` and every other page path get
 * `index.html` with the console's security headers and no caching; a built file gets its own type,
 * cached for good under `assets/`, whose names carry their hash. Returns `false` when the request
 * is not the console's, such as an unknown file or another method, so the caller answers 404.
 */
export function answerConsole(
  request: IncomingMessage,
  response: ServerResponse,
  context: { readonly files: ConsoleFiles; readonly path: string },
): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }
  const { files, path } = context;
  const file = fileOf(path);
  const body = file === undefined ? undefined : files.get(file);
  if (file === undefined || body === undefined) {
    return false;
  }
  const type = contentTypes[extname(file)] ?? "application/octet-stream";
  const page = file === "index.html";
  response.writeHead(200, {
    "content-type": type,
    "content-length": String(body.byteLength),
    "cache-control": page ? "no-store" : cacheOf(file),
    ...(page ? securityHeaders(path) : { "x-content-type-options": "nosniff" }),
  });
  send(response, request, body);
  return true;
}
