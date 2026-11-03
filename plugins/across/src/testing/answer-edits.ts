import { z } from "zod";
import { usdcToBaseAnswer } from "./recorded-quotes.js";

/** What a test changes in the recorded USDC answer to Base, each optional. */
export interface AnswerEdit {
  /** The deposit's `outputAmount` and the answer's least and expected outputs, together. */
  readonly output?: bigint;
  /** The answer's least output alone. */
  readonly minOutput?: bigint;
  /** The bridge step's relayer fee. */
  readonly relayerFee?: bigint;
  /** The deposit's fill deadline, Unix seconds. */
  readonly fillDeadline?: number;
  /** The deposit's exclusivity parameter, in seconds. */
  readonly exclusivity?: number;
  /** The answer's quote expiry, Unix seconds. */
  readonly expiry?: number;
}

/**
 * Across's calldata with the 32-byte word of the deposit's `index`th argument, after the selector,
 * set to `value`.
 */
export function withWord(data: string, index: number, value: bigint): string {
  const start = 10 + index * 64;
  return `${data.slice(0, start)}${value.toString(16).padStart(64, "0")}${data.slice(start + 64)}`;
}

const answerSchema = z.looseObject({
  swapTx: z.looseObject({ data: z.string() }),
  steps: z.looseObject({
    bridge: z.looseObject({
      fees: z.looseObject({
        details: z.looseObject({ relayerCapital: z.looseObject({ amount: z.string() }) }),
      }),
    }),
  }),
});

function dataWith(data: string, edit: AnswerEdit): string {
  const heads: readonly (readonly [number, bigint | number | undefined])[] = [
    [5, edit.output],
    [9, edit.fillDeadline],
    [10, edit.exclusivity],
  ];
  return heads.reduce(
    (text, [index, value]) => (value === undefined ? text : withWord(text, index, BigInt(value))),
    data,
  );
}

/**
 * The recorded USDC answer to Base with some of its fields changed, as a test sends it: the
 * deposit's heads in the encoded call, and the answer's own fields beside it.
 */
export function editedAnswer(edit: AnswerEdit): string {
  const answer = answerSchema.parse(JSON.parse(usdcToBaseAnswer));
  const { details } = answer.steps.bridge.fees;
  const output = edit.output?.toString();
  const relayer = details.relayerCapital;
  return JSON.stringify({
    ...answer,
    ...(output === undefined ? {} : { expectedOutputAmount: output, minOutputAmount: output }),
    ...(edit.minOutput === undefined ? {} : { minOutputAmount: edit.minOutput.toString() }),
    ...(edit.expiry === undefined ? {} : { quoteExpiryTimestamp: edit.expiry }),
    swapTx: { ...answer.swapTx, data: dataWith(answer.swapTx.data, edit) },
    steps: {
      bridge: {
        ...answer.steps.bridge,
        fees: {
          ...answer.steps.bridge.fees,
          details: {
            ...details,
            relayerCapital: {
              ...relayer,
              amount: edit.relayerFee?.toString() ?? relayer.amount,
            },
          },
        },
      },
    },
  });
}
