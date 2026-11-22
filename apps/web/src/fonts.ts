import localFont from "next/font/local";

const hanken = localFont({
  src: "../node_modules/@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-sans",
});

/** The class that sets `--font-sans` to Hanken Grotesk. */
export const sansVariable: string = hanken.variable;
