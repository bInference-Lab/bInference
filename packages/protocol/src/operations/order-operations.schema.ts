import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import {
  type OrderRequest,
  orderRequestSchema,
  type WebhookRuleRequest,
  webhookRuleRequestSchema,
} from "../requests/fill-rule-request.schema.js";
import { type Empty, emptyArgsSchema, emptyResultSchema } from "../values/empty.schema.js";
import {
  type Page,
  type PageArgs,
  pageArgsSchema,
  pageArgsShape,
  pageSchema,
} from "../values/page.schema.js";
import {
  type AlertCondition,
  alertConditionSchema,
  type AlertView,
  alertViewSchema,
} from "../views/alert-view.schema.js";
import {
  type OrderState,
  orderStateSchema,
  type OrderView,
  orderViewSchema,
} from "../views/order-view.schema.js";
import {
  type ScheduleView,
  scheduleViewSchema,
  type ScheduleWhen,
  scheduleWhenSchema,
} from "../views/schedule-view.schema.js";
import { type WebhookRuleView, webhookRuleViewSchema } from "../views/webhook-rule-view.schema.js";
import { readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

/** The args of an operation on one auto order. */
interface OrderArgs {
  readonly order: ProtocolId<"autoOrder">;
}

/** The args of `order/list`. */
interface ListOrdersArgs extends PageArgs {
  readonly agent?: ProtocolId<"agent">;
  readonly state?: OrderState;
}

/** The args of `alert/create`. */
interface CreateAlertArgs {
  readonly agent: ProtocolId<"agent">;
  readonly condition: AlertCondition;
}

/** The args of an operation on one webhook rule. */
interface RuleArgs {
  readonly rule: ProtocolId<"webhookRule">;
}

/** The args of `schedule/create`. */
interface CreateScheduleArgs {
  readonly agent: ProtocolId<"agent">;
  readonly when: ScheduleWhen;
  readonly prompt: string;
}

/** The auto order, alert, webhook rule and schedule operations of protocol spec section 7.5. */
export interface OrderOperationShapes {
  readonly "order/create": { readonly args: OrderRequest; readonly result: OrderView };
  readonly "order/get": { readonly args: OrderArgs; readonly result: OrderView };
  readonly "order/list": { readonly args: ListOrdersArgs; readonly result: Page<OrderView> };
  readonly "order/cancel": { readonly args: OrderArgs; readonly result: OrderView };
  readonly "alert/create": { readonly args: CreateAlertArgs; readonly result: AlertView };
  readonly "alert/list": { readonly args: PageArgs; readonly result: Page<AlertView> };
  readonly "alert/delete": {
    readonly args: { readonly alert: ProtocolId<"alert"> };
    readonly result: Empty;
  };
  readonly "webhookRule/create": {
    readonly args: WebhookRuleRequest;
    /** `url` holds the rule's secret and is shown this once. */
    readonly result: { readonly rule: ProtocolId<"webhookRule">; readonly url: string };
  };
  readonly "webhookRule/list": { readonly args: Empty; readonly result: Page<WebhookRuleView> };
  readonly "webhookRule/delete": { readonly args: RuleArgs; readonly result: Empty };
  readonly "webhookRule/rotateUrl": {
    readonly args: RuleArgs;
    readonly result: { readonly url: string };
  };
  readonly "schedule/create": { readonly args: CreateScheduleArgs; readonly result: ScheduleView };
  readonly "schedule/list": {
    readonly args: { readonly agent?: ProtocolId<"agent"> };
    readonly result: Page<ScheduleView>;
  };
  readonly "schedule/cancel": {
    readonly args: { readonly schedule: ProtocolId<"schedule"> };
    readonly result: Empty;
  };
}

const agent = protocolIdSchema("agent");
const orderArgs = z.strictObject({ order: protocolIdSchema("autoOrder") });
const ruleArgs = z.strictObject({ rule: protocolIdSchema("webhookRule") });
const secretUrl = z.string().min(1);

/** The auto order, alert, webhook rule and schedule operations, by name. */
export const orderOperations: OperationTable<OrderOperationShapes> = {
  "order/create": {
    ...writeFlags,
    name: "order/create",
    scope: "propose",
    args: orderRequestSchema,
    result: orderViewSchema,
  },
  "order/get": {
    ...readFlags,
    name: "order/get",
    scope: "read",
    args: orderArgs,
    result: orderViewSchema,
  },
  "order/list": {
    ...readFlags,
    name: "order/list",
    scope: "read",
    args: z.strictObject({
      ...pageArgsShape,
      agent: agent.exactOptional(),
      state: orderStateSchema.exactOptional(),
    }),
    result: pageSchema(orderViewSchema),
  },
  "order/cancel": {
    ...writeFlags,
    name: "order/cancel",
    scope: "propose",
    args: orderArgs,
    result: orderViewSchema,
  },
  "alert/create": {
    ...writeFlags,
    name: "alert/create",
    scope: "propose",
    args: z.strictObject({ agent, condition: alertConditionSchema }),
    result: alertViewSchema,
  },
  "alert/list": {
    ...readFlags,
    name: "alert/list",
    scope: "read",
    args: pageArgsSchema,
    result: pageSchema(alertViewSchema),
  },
  "alert/delete": {
    ...writeFlags,
    name: "alert/delete",
    scope: "propose",
    args: z.strictObject({ alert: protocolIdSchema("alert") }),
    result: emptyResultSchema,
  },
  "webhookRule/create": {
    ...writeFlags,
    name: "webhookRule/create",
    scope: "admin",
    args: webhookRuleRequestSchema,
    result: z.object({ rule: protocolIdSchema("webhookRule"), url: secretUrl }),
  },
  "webhookRule/list": {
    ...readFlags,
    name: "webhookRule/list",
    scope: "read",
    args: emptyArgsSchema,
    result: pageSchema(webhookRuleViewSchema),
  },
  "webhookRule/delete": {
    ...writeFlags,
    name: "webhookRule/delete",
    scope: "confirm",
    args: ruleArgs,
    result: emptyResultSchema,
  },
  "webhookRule/rotateUrl": {
    ...writeFlags,
    name: "webhookRule/rotateUrl",
    scope: "admin",
    args: ruleArgs,
    result: z.object({ url: secretUrl }),
  },
  "schedule/create": {
    ...writeFlags,
    name: "schedule/create",
    scope: "propose",
    args: z.strictObject({
      agent,
      when: scheduleWhenSchema,
      prompt: z.string().min(1),
    }),
    result: scheduleViewSchema,
  },
  "schedule/list": {
    ...readFlags,
    name: "schedule/list",
    scope: "read",
    args: z.strictObject({ agent: agent.exactOptional() }),
    result: pageSchema(scheduleViewSchema),
  },
  "schedule/cancel": {
    ...writeFlags,
    name: "schedule/cancel",
    scope: "propose",
    args: z.strictObject({ schedule: protocolIdSchema("schedule") }),
    result: emptyResultSchema,
  },
};
