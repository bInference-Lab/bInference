import { err, ok } from "@binference/core";
import { imageTypeOf, type ProtocolErrorCode } from "@binference/protocol";
import { startsAsPdf } from "../documents/pdf-head.js";
import type { EngineHandler } from "../operations/engine-call.js";
import { planEdits } from "./edit-plan.js";
import { editProblemText } from "./edit-problems.js";
import type { FileSettings } from "./file-records.js";
import { isBinary, maxFileBytes, readText, textOf, utf16TextOf } from "./file-text.js";
import { runPatch } from "./patch-run.js";
import type { FileRefusal, MachineFiles } from "./ports.js";
import { readPage } from "./read-page.js";
import { holdingAlready, writeChecked } from "./write-checked.js";

/** The handlers of the agent's file tools (protocol spec, section 7.11). */
export interface FileHandlers {
  readonly "file/read": EngineHandler<"file/read">;
  readonly "file/write": EngineHandler<"file/write">;
  readonly "file/edit": EngineHandler<"file/edit">;
  readonly "file/patch": EngineHandler<"file/patch">;
}

/**
 * The agent's files as the composition root gives them (decision 0386): the machine's files and
 * the owner's settings as they are now. Without them every file call is `file.unreadable`.
 */
export interface EngineFiles {
  readonly files: MachineFiles;
  readonly settings: () => FileSettings;
}

/** The error code each refusal of the machine's files answers with. */
export const fileRefusalCodes: Readonly<Record<FileRefusal | "binary", ProtocolErrorCode>> = {
  not_found: "file.not_found",
  walled: "file.walled",
  outside_workspace: "file.outside_workspace",
  too_large: "file.too_large",
  is_folder: "file.is_folder",
  unreadable: "file.unreadable",
  unwritable: "file.unwritable",
  exists: "file.exists",
  binary: "file.binary",
};

const encoder = new TextEncoder();

// The answer of every file call on an engine with no files.
const none = async () => Promise.resolve(err("file.unreadable" as const));

function readHandler({ files, settings }: EngineFiles): EngineHandler<"file/read"> {
  return async ({ args, signal }) => {
    const call = { signal, workspaceOnly: settings().workspaceOnly };
    const read = await files.read(args.path, { ...call, maxBytes: maxFileBytes });
    if (!read.ok) {
      return err(fileRefusalCodes[read.error]);
    }
    const { path, bytes } = read.value;
    if (imageTypeOf(bytes) !== undefined) {
      return ok({ kind: "image", path });
    }
    if (startsAsPdf(bytes)) {
      return ok({ kind: "pdf", path });
    }
    const utf16 = utf16TextOf(bytes);
    if (utf16 === undefined && isBinary(bytes)) {
      return err("file.binary");
    }
    const request = {
      ...(args.offset === undefined ? {} : { offset: args.offset }),
      ...(args.limit === undefined ? {} : { limit: args.limit }),
      ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    };
    return ok(readPage({ path, text: utf16 ?? textOf(bytes).text }, request));
  };
}

function writeHandler({ files, settings }: EngineFiles): EngineHandler<"file/write"> {
  return async ({ args, signal }) => {
    const bytes = encoder.encode(args.content);
    const call = { signal, workspaceOnly: settings().workspaceOnly };
    const file = { path: args.path, bytes };
    const held = await holdingAlready(files, file, call);
    if (held !== undefined) {
      return ok({ path: held, changed: false, bytes: bytes.byteLength });
    }
    const written = await writeChecked(files, file, call);
    return written.ok
      ? ok({ path: written.value, changed: true, bytes: bytes.byteLength })
      : err(fileRefusalCodes[written.error]);
  };
}

function editHandler({ files, settings }: EngineFiles): EngineHandler<"file/edit"> {
  return async ({ args, signal }) => {
    const call = { signal, workspaceOnly: settings().workspaceOnly };
    const read = await readText(files, args.path, call);
    if (!read.ok) {
      return err(fileRefusalCodes[read.error]);
    }
    const { path, text, bom } = read.value;
    const outcome = planEdits(bom + text, args.edits);
    if (outcome.kind === "refused") {
      const oldTexts = args.edits.map((each) => each.oldText);
      const problem = editProblemText(outcome.problem, { text, oldTexts });
      return ok({ path, changed: false, bytes: encoder.encode(bom + text).byteLength, problem });
    }
    const { plan } = outcome;
    const bytes = encoder.encode(plan.text);
    if (!plan.changed) {
      return ok({ path, changed: false, bytes: bytes.byteLength, replaced: 0 });
    }
    const written = await writeChecked(files, { path: args.path, bytes }, call);
    return written.ok
      ? ok({ path, changed: true, bytes: bytes.byteLength, replaced: plan.replaced })
      : err(fileRefusalCodes[written.error]);
  };
}

function patchHandler({ files, settings }: EngineFiles): EngineHandler<"file/patch"> {
  return async ({ args, signal }) => {
    const { workspaceOnly, patchWorkspaceOnly } = settings();
    // Either setting keeps a patch inside the workspace, the stricter one deciding.
    return ok(
      await runPatch(files, args.input, {
        signal,
        workspaceOnly: workspaceOnly || patchWorkspaceOnly,
      }),
    );
  };
}

/**
 * The agent's file handlers (decision 0386): `file/read` pages a text file and names an image
 * file for `image/view` and a PDF for `pdf/read` (decision 0402); `file/write` writes a file
 * whole; `file/edit` makes exact replacements;
 * `file/patch` runs a patch, writing nothing until every change is found. Reads, writes and edits
 * stay inside the workspace when the owner's `workspaceOnly` says so, patches when
 * `patchWorkspaceOnly` does. Without files every call is `file.unreadable`.
 */
export function createFileHandlers(files: EngineFiles | undefined): FileHandlers {
  if (files === undefined) {
    return { "file/read": none, "file/write": none, "file/edit": none, "file/patch": none };
  }
  return {
    "file/read": readHandler(files),
    "file/write": writeHandler(files),
    "file/edit": editHandler(files),
    "file/patch": patchHandler(files),
  };
}
