// oxlint-disable-next-line eslint/no-restricted-imports -- the launcher clears its own socket
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { imageFolders, imageLayout } from "./image-layout.js";
import { procResident } from "./proc-resident.js";
import { serveLauncher } from "./serve-launcher.js";

// The image's plugin launcher (decision 0344), which the image entry starts as the plugin user.
// It reads no argument, variable or input of its own: its socket and folders are the image's,
// and the plugin program and probe sit beside it in the built package.
const beside = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const probeFolder = beside("./probe");
// A socket a launcher before it left; the folder is the plugin user's own.
await rm(imageLayout.socket, { force: true });
await serveLauncher(
  {
    socket: imageLayout.socket,
    program: beside("./plugin-process.mjs"),
    folders: (id) => imageFolders(id, probeFolder),
    env: {},
    memory: procResident,
  },
  new AbortController().signal,
);
