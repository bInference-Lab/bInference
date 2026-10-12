import { type Clock, type HostLookup, maxUrlChars } from "@binference/core";
import { z } from "zod";
import type { ToolOutcome } from "../loop/turn-records.js";
import type { StreamingHttp } from "../providers/ports.js";
import {
  maxPageBytes,
  maxRedirects,
  type PageRead,
  type PageRefused,
  readPublicPage,
} from "../web/read-page.js";
import { outsideAnswer, refusalAnswer } from "../web/web-answers.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";

/** How the web tools reach the internet. */
export interface WebToolParts {
  readonly http: StreamingHttp;
  /** Looks a page's host up, for the URL guard. */
  readonly lookup: HostLookup;
  readonly clock: Clock;
}

const refusalTexts: Readonly<
  Record<Exclude<PageRefused["reason"], "status" | "content_type">, string>
> = {
  not_url: `it is not an absolute URL of at most ${String(maxUrlChars)} characters`,
  scheme: "read_page reads http and https URLs only",
  credentials: "the URL carries a user name or a password",
  private_host:
    "its host is not on the public internet: a local, private or metadata address, which read_page never reaches",
  private_address:
    "its host does not resolve to public internet addresses only, which read_page needs",
  too_many_redirects: `the page redirects more than ${String(maxRedirects)} times`,
  redirect_without_location: "the server redirects without saying where",
  encoding: "the server compressed the page, though binference asked for no compression",
  timeout: "the page did not arrive within 20 seconds",
  unreachable: "the server could not be reached",
};

// A content type is the server's word: only one in the usual form is repeated.
function typeText(contentType: string | undefined): string {
  return contentType !== undefined && /^[a-z\d.+-]{1,60}\/[a-z\d.+-]{1,60}$/.test(contentType)
    ? contentType
    : "of a type it does not name";
}

function refusalText(refusal: PageRefused): string {
  if (refusal.reason === "status") {
    return `the server answered with status ${String(refusal.status ?? 0)}`;
  }
  if (refusal.reason === "content_type") {
    return `the page is ${typeText(refusal.contentType)}; read_page reads HTML, text, Markdown, JSON, XML, feeds and CSV`;
  }
  return refusalTexts[refusal.reason];
}

function pageAnswer(page: PageRead): ToolOutcome {
  const size = page.cut
    ? [`size: only the first ${String(maxPageBytes / 1024 / 1024)} MiB of a larger page was read`]
    : [];
  const title = page.title === undefined ? [] : [`title: ${page.title}`];
  return outsideAnswer("a web page", [`url: ${page.url}`, ...size, ...title, "", page.text]);
}

function readPageTool(web: WebToolParts): AgentTool {
  return defineTool({
    name: "read_page",
    kind: "read",
    parallel: true,
    description: agentToolTexts.read_page,
    args: z.strictObject({ url: z.string().trim().min(1).max(maxUrlChars) }),
    run: async (args, { signal }) => {
      const read = await readPublicPage(args.url, web, signal);
      return read.kind === "page"
        ? pageAnswer(read)
        : refusalAnswer(`not read: ${refusalText(read)}.`);
    },
  });
}

/**
 * The agent's web tools (decision 0205): `read_page`, whose page is outside content and marks the
 * turn.
 */
export function webTools(web: WebToolParts): readonly AgentTool[] {
  return [readPageTool(web)];
}
