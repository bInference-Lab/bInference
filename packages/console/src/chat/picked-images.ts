import { type ImageContentType, maxImageBytes, maxImagesPerMessage } from "@binference/protocol";

/** An image the owner picked or pasted: what the browser knows of the file. */
export interface PickedFile {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

/** A picked image the message keeps: its type is one the agent reads. */
export type CheckedImage<F extends PickedFile> = F & { readonly contentType: ImageContentType };

/** Why the console left a picked image out, with the file's name. */
export interface ImageRefusal {
  readonly reason: "tooMany" | "tooLarge" | "format";
  readonly name: string;
}

const formats: ReadonlySet<string> = new Set<ImageContentType>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function isImageType(type: string): type is ImageContentType {
  return formats.has(type);
}

/**
 * The images a message keeps after the owner adds more, checked in the browser before any upload
 * by the limits the engine enforces (protocol spec, section 7.7): PNG, JPEG or WebP by the type
 * the browser names, at most 5 MiB each, at most 4 a message. Each one left out says why.
 */
export function pickImages<F extends PickedFile>(
  held: readonly CheckedImage<F>[],
  added: readonly F[],
): { readonly kept: readonly CheckedImage<F>[]; readonly refused: readonly ImageRefusal[] } {
  const kept = [...held];
  const refused: ImageRefusal[] = [];
  added.forEach((file) => {
    const { name, type } = file;
    if (!isImageType(type)) {
      refused.push({ reason: "format", name });
    } else if (file.size > maxImageBytes) {
      refused.push({ reason: "tooLarge", name });
    } else if (kept.length >= maxImagesPerMessage) {
      refused.push({ reason: "tooMany", name });
    } else {
      kept.push({ ...file, contentType: type });
    }
  });
  return { kept, refused };
}
