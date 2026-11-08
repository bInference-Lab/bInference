import { createHash } from "node:crypto";

/** A page of a PDF the tests make: lines of text, a picture, or both. */
export interface TestPage {
  readonly lines?: readonly string[];
  /** An RGB picture drawn across the page, `width` by `height` pixels. */
  readonly picture?: { readonly width: number; readonly height: number };
  /** The page's size in points; a US letter page when absent. */
  readonly size?: readonly [number, number];
}

// The padding the PDF standard's security handler appends to every password.
const padding = Buffer.from(
  "28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A",
  "hex",
);
const fileId = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
// Every permission the PDF standard names, as its 32-bit flags.
const permissions = -44;

function md5(...parts: readonly Readonly<Buffer>[]): Buffer {
  return createHash("md5").update(Buffer.concat(parts)).digest();
}

// A byte of a buffer or of RC4's state, 0 past its end.
function at(bytes: Readonly<Uint8Array>, index: number): number {
  return bytes[index] ?? 0;
}

function rc4State(key: Readonly<Buffer>): Uint8Array {
  const state = Uint8Array.from({ length: 256 }, (_value, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + at(state, i) + at(key, i % key.length)) % 256;
    const kept = at(state, i);
    state[i] = at(state, j);
    state[j] = kept;
  }
  return state;
}

function rc4(key: Readonly<Buffer>, data: Readonly<Buffer>): Buffer {
  const state = rc4State(key);
  const out = Buffer.alloc(data.length);
  let i = 0;
  let j = 0;
  for (let k = 0; k < data.length; k += 1) {
    i = (i + 1) % 256;
    j = (j + at(state, i)) % 256;
    const kept = at(state, i);
    state[i] = at(state, j);
    state[j] = kept;
    out[k] = at(data, k) ^ at(state, (at(state, i) + at(state, j)) % 256);
  }
  return out;
}

/** The 40-bit RC4 key and the dictionary values of the standard security handler, revision 2. */
interface Lock {
  readonly key: Buffer;
  readonly owner: Buffer;
  readonly user: Buffer;
}

function lockOf(password: string): Lock {
  const padded = Buffer.concat([Buffer.from(password, "latin1"), padding]).subarray(0, 32);
  const owner = rc4(md5(padded).subarray(0, 5), padded);
  const flags = Buffer.alloc(4);
  flags.writeInt32LE(permissions);
  const key = md5(padded, owner, flags, fileId).subarray(0, 5);
  return { key, owner, user: rc4(key, padding) };
}

function encrypt(lock: Lock | undefined, object: number, data: Readonly<Buffer>): Buffer {
  if (lock === undefined) {
    return Buffer.from(data);
  }
  const salt = Buffer.from([object % 256, Math.floor(object / 256) % 256, 0, 0, 0]);
  return rc4(md5(lock.key, salt).subarray(0, 10), data);
}

type Body = string | { readonly head: string; readonly stream: Buffer };

// The content stream of a page: its picture across most of it, then its lines from the top.
function contentOf(page: TestPage, height: number): string {
  const picture = page.picture === undefined ? [] : ["q 500 0 0 700 50 50 cm /P1 Do Q"];
  const lines = (page.lines ?? []).map((line, index) => {
    const text = line.replaceAll(/[()\\]/gu, (char) => `\\${char}`);
    return `BT /F1 12 Tf 50 ${String(height - 42 - index * 14)} Td (${text}) Tj ET`;
  });
  return [...picture, ...lines].join("\n");
}

function pictureBytes(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(width * height * 3);
  for (let offset = 0; offset < bytes.length; offset += 3) {
    bytes[offset] = 200;
    bytes[offset + 1] = (offset / 3) % 256;
    bytes[offset + 2] = 40;
  }
  return bytes;
}

/** Writes objects as a PDF file: header, objects, cross-reference table and trailer. */
function writeFile(bodies: readonly Body[], trailer: string, lock: Lock | undefined): Uint8Array {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%âãÏÓ\n", "latin1")];
  const offsets: number[] = [];
  let length = parts[0]?.length ?? 0;
  bodies.forEach((body, index) => {
    const number = index + 1;
    const part =
      typeof body === "string"
        ? Buffer.from(`${String(number)} 0 obj\n${body}\nendobj\n`, "latin1")
        : streamObject(number, body, lock);
    offsets.push(length);
    parts.push(part);
    length += part.length;
  });
  const rows = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`);
  const table = `xref\n0 ${String(bodies.length + 1)}\n0000000000 65535 f \n${rows.join("")}`;
  const end = `trailer\n${trailer}\nstartxref\n${String(length)}\n%%EOF\n`;
  parts.push(Buffer.from(table + end, "latin1"));
  return new Uint8Array(Buffer.concat(parts));
}

function streamObject(
  number: number,
  body: { readonly head: string; readonly stream: Buffer },
  lock: Lock | undefined,
): Buffer {
  const data = encrypt(lock, number, body.stream);
  const head = `${String(number)} 0 obj\n${body.head} /Length ${String(data.length)} >>\nstream\n`;
  return Buffer.concat([Buffer.from(head, "latin1"), data, Buffer.from("\nendstream\nendobj\n")]);
}

/**
 * Makes a PDF of `pages` with the built-in Helvetica font, encrypted with `password` by the
 * standard security handler (RC4, 40 bits) when one is given. Test data only.
 */
export function makeTestPdf(pages: readonly TestPage[], password?: string): Uint8Array {
  const lock = password === undefined ? undefined : lockOf(password);
  const bodies: Body[] = ["", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids: number[] = [];
  for (const page of pages) {
    const [width, height] = page.size ?? [612, 792];
    const picture = page.picture;
    if (picture !== undefined) {
      const head = `<< /Type /XObject /Subtype /Image /Width ${String(picture.width)} /Height ${String(picture.height)} /ColorSpace /DeviceRGB /BitsPerComponent 8`;
      bodies.push({ head, stream: pictureBytes(picture.width, picture.height) });
    }
    const pictures = picture === undefined ? "" : `/XObject << /P1 ${String(bodies.length)} 0 R >>`;
    bodies.push({ head: "<<", stream: Buffer.from(contentOf(page, height), "latin1") });
    const content = bodies.length;
    bodies.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(width)} ${String(height)}] /Resources << /Font << /F1 3 0 R >> ${pictures} >> /Contents ${String(content)} 0 R >>`,
    );
    kids.push(bodies.length);
  }
  bodies[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  bodies[1] = `<< /Type /Pages /Kids [${kids.map((kid) => `${String(kid)} 0 R`).join(" ")}] /Count ${String(kids.length)} >>`;
  if (lock !== undefined) {
    bodies.push(
      `<< /Filter /Standard /V 1 /R 2 /O <${lock.owner.toString("hex")}> /U <${lock.user.toString("hex")}> /P ${String(permissions)} >>`,
    );
  }
  const locked =
    lock === undefined
      ? ""
      : ` /Encrypt ${String(bodies.length)} 0 R /ID [<${fileId.toString("hex")}> <${fileId.toString("hex")}>]`;
  return writeFile(bodies, `<< /Size ${String(bodies.length + 1)} /Root 1 0 R${locked} >>`, lock);
}
