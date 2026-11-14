import { reasonText } from "@binference/i18n";
import type { OrderFillView, ProtocolId } from "@binference/protocol";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { useFormatter, useText } from "../i18n/console-text";
import { ScreenState } from "../screens/screen-state";
import { useOrderFills } from "./use-orders";

function FillRow(props: {
  readonly fill: OrderFillView;
  readonly isPaper: boolean;
}): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { fill, isPaper } = props;
  // A reason whose words take values shows them when its row kept them, else a plain skip.
  const reason =
    fill.reason === undefined ? undefined : reasonText(formatter, fill.reason, fill.reasonValues);
  return (
    <TableRow>
      <TableCell className="tabular-nums">{formatter.dateTime(fill.at)}</TableCell>
      <TableCell className="whitespace-normal">
        {text("console.orders.fill.outcome", {
          outcome: fill.outcome,
          paper: isPaper ? "yes" : "no",
          hasReason: reason === undefined ? "no" : "yes",
          reason: reason ?? "",
        })}
      </TableCell>
    </TableRow>
  );
}

/**
 * An order's newest fills and skips, newest first, as `order/get` answers them: when each came
 * and what it became, a skip with its reason in words; a note when older ones exist.
 */
export function OrderFills(props: {
  readonly order: ProtocolId<"autoOrder">;
  readonly isPaper: boolean;
}): React.JSX.Element {
  const text = useText();
  const read = useOrderFills(props.order);
  const fills = read.data?.fillHistory;
  if (read.data === undefined) {
    return <ScreenState error={read.error} />;
  }
  if (fills === undefined || fills.length === 0) {
    return <p className="text-sm text-muted-foreground">{text("console.orders.fillsEmpty")}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <Table aria-label={text("console.orders.fillsTitle")}>
        <TableHeader>
          <TableRow>
            <TableHead>{text("console.orders.fill.when")}</TableHead>
            <TableHead>{text("console.orders.fill.what")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fills.map((fill) => (
            <FillRow key={fill.fill} fill={fill} isPaper={props.isPaper} />
          ))}
        </TableBody>
      </Table>
      {read.data.fillHistoryMore === true ? (
        <p className="text-sm text-muted-foreground">{text("console.orders.fillsMore")}</p>
      ) : null}
    </div>
  );
}
