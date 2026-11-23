import type { ImageResponse } from "next/og";
import { shareImage, shareImageSize } from "../../landing/share-image";
import { wordsFor } from "../../words/words";

/** What the English link picture shows, for readers who cannot see it. */
export const alt: string = wordsFor("en").text("meta.imageAlt");

/** The English link picture's size. */
export const size: { readonly width: number; readonly height: number } = shareImageSize;

/** The English link picture's format. */
export const contentType = "image/png";

/** The picture a link to the English page shows, drawn once at build time. */
export default function OpenGraphImage(): Promise<ImageResponse> {
  return shareImage("en");
}
