import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { agentFigureSvg, figureBox } from "../agent/agent-figure";
import { type Locale, wordsFor } from "../words/words";

/** The size of the picture a link to the site shows, as the big link cards expect it. */
export const shareImageSize: { readonly width: number; readonly height: number } = {
  width: 1200,
  height: 630,
};

const fontFolder = "node_modules/@fontsource/hanken-grotesk/files";
const figureHeight = 560;

function dataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// The image is drawn at build time from the app's own folder, so its font and lockup are read
// from there rather than fetched.
async function readAsset(path: string): Promise<Buffer> {
  return readFile(join(/* turbopackIgnore: true */ process.cwd(), path));
}

/**
 * The picture a link to the site shows: the brand lockup, the product's name with a gold stop, and
 * the agent as the page first draws it. It holds no sentence, so both languages share its look.
 */
export async function shareImage(locale: Locale): Promise<ImageResponse> {
  const [light, lockup] = await Promise.all([
    readAsset(`${fontFolder}/hanken-grotesk-latin-300-normal.woff`),
    readAsset("public/lockup.svg"),
  ]);
  const figureWidth = Math.round((figureHeight * figureBox.width) / figureBox.height);
  const name = wordsFor(locale).text("meta.shareName");
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: "0 72px 0 104px",
        background: "#0b0e11",
        fontFamily: "Hanken Grotesk",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <img src={dataUri(lockup.toString("utf8"))} width={250} height={56} alt="" />
        <div
          style={{
            display: "flex",
            marginTop: 18,
            fontSize: 168,
            fontWeight: 300,
            lineHeight: 1,
            letterSpacing: "-0.045em",
            color: "#eaecef",
          }}
        >
          {name}
          <span style={{ color: "#f0b90b" }}>.</span>
        </div>
      </div>
      <img src={dataUri(agentFigureSvg())} width={figureWidth} height={figureHeight} alt="" />
    </div>,
    {
      ...shareImageSize,
      fonts: [{ name: "Hanken Grotesk", data: light, weight: 300, style: "normal" }],
    },
  );
}
