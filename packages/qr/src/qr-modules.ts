import { encodeQR } from "qr";

/**
 * A QR code as a square of modules, `true` for a dark one, rows from the top, its quiet zone of
 * four light modules on every side included.
 */
export type QrModules = readonly (readonly boolean[])[];

// Four light modules around the code are the quiet zone scanners need.
const quietModules = 4;

/**
 * The modules of a QR code that holds `text` exactly, with quartile error correction, so a code
 * stays readable after a chat app compresses its picture. The code holds nothing but the text: a
 * wallet that scans an address reads the address as written, its letter case kept.
 */
export function qrModules(text: string): QrModules {
  return encodeQR(text, "raw", { ecc: "quartile", border: quietModules });
}
