import { noticeAssetsToRead, writeNotice } from "@binference/i18n";
import type { AssetInfo, NoticePushView } from "@binference/protocol";
import { useQueries } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { MessageLine } from "../cards/card-line";
import { Button } from "../components/ui/button";
import { useEngine } from "../connection/engine-context";
import { useFormatter, useText } from "../i18n/console-text";

/** An asset a notice's amount names. */
type NoticeAsset = ReturnType<typeof noticeAssetsToRead>[number];

// The info of each registry token the notice names, once the engine answered; a token it cannot
// name is written in base units with its short address, as on every surface.
function useAssetInfos(
  notice: NoticePushView,
): ((asset: NoticeAsset) => AssetInfo | undefined) | undefined {
  const { client } = useEngine();
  const assets = noticeAssetsToRead(notice);
  const answers = useQueries({
    queries: assets.map((asset) => ({
      queryKey: ["asset", asset],
      queryFn: async ({ signal }: { readonly signal: AbortSignal }) =>
        client.call("asset/get", { asset }, { signal }),
      staleTime: Number.POSITIVE_INFINITY,
      retry: false,
    })),
  });
  if (answers.some((answer) => answer.isPending)) {
    return undefined;
  }
  const read = new Map(assets.map((asset, at) => [asset, answers[at]?.data]));
  return (asset) => notice.assets?.[asset] ?? read.get(asset);
}

/** One notice in the notice area: its lines in the owner's language, its time, and Dismiss. */
export function NoticeItem(props: {
  readonly notice: NoticePushView;
  readonly dismiss: () => void;
}): React.JSX.Element {
  const { notice } = props;
  const text = useText();
  const formatter = useFormatter();
  const assetInfo = useAssetInfos(notice);
  const lines =
    assetInfo === undefined ? [] : writeNotice(notice, { formatter, assetInfo }).split("\n");
  return (
    <li
      aria-busy={assetInfo === undefined}
      className="flex items-start gap-3 rounded-lg border px-3 py-2 text-sm"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {lines.map((line, at) => (
          <p key={`${String(at)} ${line}`} className="break-words">
            <MessageLine text={line} />
          </p>
        ))}
        <time
          dateTime={new Date(notice.at).toISOString()}
          className="text-xs text-muted-foreground"
        >
          {formatter.dateTime(notice.at)}
        </time>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={text("console.notices.dismiss")}
        onClick={props.dismiss}
      >
        <XIcon aria-hidden strokeWidth={1.5} />
      </Button>
    </li>
  );
}
