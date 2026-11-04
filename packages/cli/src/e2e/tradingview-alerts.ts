// Two alerts of a TradingView strategy on BINANCE:BNBUSDT at 15 minutes, written to the shape
// TradingView's help center documents, not captured from a live alert. "About webhooks"
// (tradingview.com/support/solutions/43000529348) says an alert is one POST whose body is the
// alert's message, sent as `application/json` when the message is valid JSON and as `text/plain`
// otherwise; "How to use a variable value in alert" (tradingview.com/support/solutions/43000531021)
// lists the placeholders the message below fills in: `{{ticker}}`, `{{exchange}}`, `{{interval}}`,
// `{{close}}`, `{{time}}`, `{{timenow}}` as `yyyy-MM-ddTHH:mm:ssZ`, `{{strategy.order.action}}`
// and `{{strategy.order.contracts}}`. The body is the message the owner wrote, so it carries no
// `id` unless that message names one: these repeat by the body's hash.

/** The headers TradingView sends with a message that is valid JSON. */
export const tradingViewHeaders: Readonly<Record<string, string>> = {
  "content-type": "application/json",
};

/** The strategy's buy alert at the close of the 09:00 bar. */
export const tradingViewBuy: string =
  '{"ticker":"BNBUSDT","exchange":"BINANCE","interval":"15","close":612.4,"time":"2026-11-04T09:00:00Z","timenow":"2026-11-04T09:15:00Z","action":"buy","contracts":"0.5"}';

/** The strategy's second entry on the same bar, a second later, as a pyramiding strategy sends. */
export const tradingViewSecondBuy: string =
  '{"ticker":"BNBUSDT","exchange":"BINANCE","interval":"15","close":612.4,"time":"2026-11-04T09:00:00Z","timenow":"2026-11-04T09:15:01Z","action":"buy","contracts":"0.25"}';
