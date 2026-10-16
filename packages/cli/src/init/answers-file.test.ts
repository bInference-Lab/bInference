import { join } from "node:path";
import { createPlatform, writePrivateFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { readAnswersFile } from "./answers-file.js";

const folders: TempFolder[] = [];
const writing = { permissions: createPlatform().permissions, signal: new AbortController().signal };
const signal = new AbortController().signal;

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

async function answersFile(text: string): Promise<string> {
  const folder = await createTempFolder("bnf-answers-");
  folders.push(folder);
  const file = join(folder.path, "answers.json5");
  await writePrivateFile(file, text, writing);
  return file;
}

describe("the answers file", () => {
  it("gives each answer as its flag takes it, and its set keys as --set flags", async () => {
    const file = await answersFile(`{
      privyAppId: "app",
      privyAppSecret: { fromFile: "/run/secrets/privy" },
      unlockCommand: { fromCommand: ["op", "read", "op://vault/agent"] },
      acceptDisclaimer: false,
      set: { "telemetry.enabled": true, "owner.timezone": "Asia/Shanghai" },
    }`);

    await expect(readAnswersFile(file, signal)).resolves.toStrictEqual({
      ok: true,
      value: {
        file,
        answers: {
          privyAppId: "app",
          privyAppSecret: '{"fromFile":"/run/secrets/privy"}',
          unlockCommand: '{"fromCommand":["op","read","op://vault/agent"]}',
          acceptDisclaimer: false,
        },
        sets: ["telemetry.enabled=true", "owner.timezone=Asia/Shanghai"],
      },
    });
  });

  it("keeps a secret written as text, for the check after to refuse", async () => {
    const file = await answersFile('{ botToken: "123456:AAE-secret" }');

    await expect(readAnswersFile(file, signal)).resolves.toMatchObject({
      value: { answers: { botToken: "123456:AAE-secret" } },
    });
  });

  it("names a key init does not take, never its value", async () => {
    const file = await answersFile('{ privyAppSecretValue: "s3cr3t-value" }');

    const read = await readAnswersFile(file, signal);

    expect(read).toStrictEqual({
      ok: false,
      refusal: {
        code: "init.answers_invalid",
        key: "refused.answersInvalid",
        values: { file, key: "privyAppSecretValue" },
      },
    });
    expect(JSON.stringify(read)).not.toContain("s3cr3t-value");
  });

  it("names the line and column of a syntax error, never the text there", async () => {
    const file = await answersFile('{\n  botToken: "123456:AAE-secret"\n  rescue: "0x1",\n}');

    const read = await readAnswersFile(file, signal);

    expect(read).toMatchObject({
      refusal: { key: "refused.answersUnreadable", values: { file, line: 3, column: 3 } },
    });
    expect(JSON.stringify(read)).not.toContain("AAE-secret");
  });

  it("refuses a file that is gone or holds no object", async () => {
    const list = await answersFile("[]");
    const gone = join(list, "..", "gone.json5");

    await expect(readAnswersFile(gone, signal)).resolves.toMatchObject({
      refusal: { code: "init.answers_missing", values: { file: gone } },
    });
    await expect(readAnswersFile(list, signal)).resolves.toMatchObject({
      refusal: { code: "init.answers_invalid", key: "refused.answersNotObject" },
    });
  });
});
