import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** A piece of the engine's source: a file, and the lines of it to show. */
interface SourcePiece {
  readonly file: string;
  readonly from: number;
  readonly to: number;
}

/** What the wall shows, column by column: the policy check, the nonce rule, the send levels, the rescue change. */
const sourceColumns: readonly (readonly SourcePiece[])[] = [
  [{ file: "packages/engine/src/policy/check-policy.ts", from: 20, to: 110 }],
  [
    { file: "packages/engine/src/wallet-queue/lowest-free-nonce.ts", from: 0, to: 48 },
    { file: "packages/engine/src/policy/send-level-change.ts", from: 0, to: 46 },
  ],
  [
    { file: "packages/engine/src/policy/rescue-change.ts", from: 0, to: 62 },
    { file: "packages/engine/src/policy/check-policy.ts", from: 110, to: 150 },
  ],
];

// The build runs in apps/web; the engine's files sit two folders up.
const repoRoot = join(process.cwd(), "..", "..");

/** One column of the wall: its files, as a key, and their lines. */
export interface SourceColumn {
  readonly id: string;
  readonly text: string;
}

/** Reads each column's text from the repository at build time, so the wall shows the real code. */
export async function readSourceColumns(signal: AbortSignal): Promise<readonly SourceColumn[]> {
  return Promise.all(
    sourceColumns.map(async (pieces) => {
      const texts = await Promise.all(
        pieces.map(async (piece) => {
          // The pages are prerendered, so this read runs at build time only: nothing is traced.
          const text = await readFile(join(/* turbopackIgnore: true */ repoRoot, piece.file), {
            encoding: "utf8",
            signal,
          });
          return text.split("\n").slice(piece.from, piece.to).join("\n");
        }),
      );
      return {
        id: pieces.map((piece) => `${piece.file}:${String(piece.from)}`).join(" "),
        text: texts.join("\n\n"),
      };
    }),
  );
}
