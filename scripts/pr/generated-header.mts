// A generated file says so near its top and names the command that writes it, such as
// "Generated from the code by pnpm docs:gen".
const header = /\bgenerated\b.*\bby `?pnpm [\w:-]+/iu;
const headerLines = 8;

/** Whether a file's first lines carry the header of a file a pnpm command generates. */
export function hasGeneratedHeader(text: string): boolean {
  return text.split("\n", headerLines).some((line) => header.test(line));
}
