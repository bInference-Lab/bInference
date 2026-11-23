/**
 * The site's own address, for links that must be whole: the production domain Vercel gives a
 * build there, else the local server. Read at build time, since every page is prerendered.
 */
export function siteUrl(): URL {
  const production = process.env["VERCEL_PROJECT_PRODUCTION_URL"];
  return new URL(
    production === undefined || production === ""
      ? "http://localhost:4819"
      : `https://${production}`,
  );
}
