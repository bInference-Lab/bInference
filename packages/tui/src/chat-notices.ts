import { noticeAssetsToRead, writeNotice } from "@binference/i18n";
import {
  type AssetInfo,
  type NoticePushView,
  noticePushViewSchema,
  type PushFrame,
  type ResultOf,
} from "@binference/protocol";
import { callOptions, type ChatContext } from "./chat-context.js";

type NoticeAsset = ReturnType<typeof noticeAssetsToRead>[number];

/** The owner's notices as the chat prints them, in the order they arrive. */
export interface ChatNotices {
  /** Prints the notice a `notice/new` push carries. */
  pushed(push: PushFrame): Promise<void>;
  /** Reads on from the last notice printed, after a gap in the `notice` topic. */
  readOn(): Promise<void>;
}

// The most pages a read after a gap goes through, and the most tokens whose info the chat keeps;
// past that it forgets them all and reads each again when a notice names it.
const readPages = 4;
const mostInfos = 200;

/**
 * The owner's notices that arrive while the chat is open (spec 4, section 4), each printed as
 * every surface writes it, in the owner's language. A registry token a notice names is read once
 * with `asset/get`; one the engine cannot name is written in base units with its short address.
 */
export function createChatNotices(context: ChatContext): ChatNotices {
  const { client, formatter } = context;
  const infos = new Map<NoticeAsset, AssetInfo | undefined>();
  const state: { last: NoticePushView["id"] | undefined } = { last: undefined };
  const readAsset = async (asset: NoticeAsset): Promise<void> => {
    if (infos.size >= mostInfos) {
      infos.clear();
    }
    if (!infos.has(asset)) {
      const info = await client
        .call("asset/get", { asset }, callOptions(context))
        .catch(() => undefined);
      infos.set(asset, info);
    }
  };
  const printNotice = async (notice: NoticePushView): Promise<void> => {
    await Promise.all(noticeAssetsToRead(notice).map(readAsset));
    const assetInfo = (asset: NoticeAsset): AssetInfo | undefined =>
      notice.assets?.[asset] ?? infos.get(asset);
    state.last = notice.id;
    context.print(
      writeNotice(notice, { formatter, assetInfo })
        .split("\n")
        .map((text) => ({ text })),
    );
  };
  return {
    pushed: async (push) => {
      const notice =
        push.kind === "notice/new" ? noticePushViewSchema.safeParse(push.data) : undefined;
      if (notice?.success === true) {
        await printNotice(notice.data);
      }
    },
    readOn: async () => {
      let cursor: string | undefined = state.last;
      for (let page = 0; page < readPages && cursor !== undefined; page += 1) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- each page reads on from the last
        const answer: ResultOf<"notice/list"> = await client.call(
          "notice/list",
          { cursor, limit: 50 },
          callOptions(context),
        );
        for (const notice of answer.items) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- each notice prints in order
          await printNotice(notice);
        }
        cursor = answer.next;
      }
    },
  };
}
