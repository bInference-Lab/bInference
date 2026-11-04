---
title: Remote access and alert rules
description: Open the Mini App from Telegram over Tailscale, and let alerts from TradingView or another sender fill a rule you confirmed once.
---

The engine listens on your machine only. `binference expose` publishes two of its parts over
Tailscale: the Mini App inside your tailnet, and, if you ask for it, the path that alert rules
receive alerts on, on the internet.

## Remote access

### Before you start

- Install Tailscale on the engine's machine and sign in with `tailscale up`.
- Turn on HTTPS certificates on the DNS page of Tailscale's admin site.
- For alert rules from the internet: allow Funnel for this machine in your tailnet's policy file.
- On Linux, let your account change Tailscale's settings once:
  `sudo tailscale set --operator=$USER`.

### Publish the Mini App

```sh
binference expose
```

Tailscale then serves the engine on port 443 of the machine's Tailscale name, inside your tailnet
only. binference writes that address into `remote.publicUrl`, unless you set your own there. Run
`binference restart`, and `/console` in Telegram opens the Mini App at that address. Your phone must
be in the same tailnet.

### Publish the alert path

```sh
binference expose --webhooks
```

This also publishes the path alert rules receive alerts on, `/hook/`, on port 8443, through
Tailscale Funnel. Everyone on the internet can reach it, so binference names the address and asks
first; `--yes` answers for you in a script. Only a rule's secret URL fills anything, and only the
`/hook/` path is public: the engine and the Mini App stay inside your tailnet.

binference takes ports 443 and 8443 whole. If Tailscale already serves something there that
binference did not set, it changes nothing and says so (`remote.port_taken`).

### Take it off

```sh
binference expose --off
```

This removes only what binference published, while each is as binference set it. Anything else that
still publishes the engine's ports is listed with the `tailscale` command that removes it, and the
command then exits with 1. Alert rules keep their URLs.

`binference check` always reads what Tailscale publishes, whatever `config.json5` records. It fails
when the engine is on the internet, or when anything but the alert path is. `remote.mini` and
`remote.webhooks` in `config.json5` are records only: changing them publishes nothing.

## Alert rules

An alert rule lets an incoming alert, such as a TradingView alert's webhook, fill a trade inside
bounds you confirmed once on its card. The alert never sets the size, the side or the token: the
rule does.

:::caution[Alert rules fill on paper only]
Live fills of alert rules are off. binference refuses a new alert rule while the agent is live, with
the error `order.live_fills_off`. Make rules while the agent is in paper mode, where each alert
fills on paper at real prices.
:::

### Make a rule

Only you make rules, in the CLI or the console's Alert rules screen. The agent and MCP clients
cannot. In the CLI:

```sh
binference webhook create --name "CAKE breakout" --token CAKE --side buy --usd 20 --rate 1
```

Give each fill's size with one of `--usd`, `--amount` or `--percent`. The other bounds:

- `--spend`: what a buy spends; the chain's coin by default.
- `--worst-price`: the worst price a fill takes, in dollars per token.
- `--slippage`: the most slippage a fill takes; it cannot be more than the agent's limit.
- `--max-fills`: the most fills before the rule ends.
- `--rate`: how many alerts the rule takes in a minute, 1 to 60; 1 by default.
- `--ttl`: how long the rule lasts, up to `365d`; 30 days by default.

The command shows the rule's URL once, then its card. The URL works once you confirm the card.
binference keeps only a hash of the URL's secret; if you lose the URL, rotate it.

An agent has at most 20 rules. A rule made before you ran `binference expose --webhooks` has a URL
on this machine only; rotate it to get the public one.

### Use it in TradingView

1. Create or edit an alert in TradingView.
2. In its notifications, turn on Webhook URL and paste the rule's URL.
3. Write any message. binference reads the body only to tell a repeat: an alert with the same body
   within 10 minutes is a repeat and fills nothing, and so is one whose JSON `id` field matches an
   earlier one. For an alert that fires more often with the same text, put a changing value in the
   message, such as TradingView's `{{timenow}}`.

Any sender that can make an HTTPS POST works the same way. The body is at most 16 KiB.

### What an alert does

- An alert fills only within 60 seconds of its arrival; a later one is skipped, never made up.
- Alerts over the rule's rate are recorded and fill nothing; the sender gets status 429.
- An unknown or wrong URL gets 404, the same answer for every case.
- Each fill counts against the agent's 24-hour cap, like any trade.
- Fills and skips send notices, at most 5 an hour per rule, then one
  [`webhookHeld`](/reference/notices/#webhookheld) line counts the rest.
- After 5 fills in a row fail, the rule is deleted, with the
  [`webhookRuleFailing`](/reference/notices/#webhookrulefailing) notice.
- A freeze stops every rule's fills.

### Manage rules

| Command                            | What it does                                        |
| ---------------------------------- | --------------------------------------------------- |
| `binference webhook list`          | Lists the rules that are active or wait for a card  |
| `binference webhook events <rule>` | Lists the alerts a rule took and what each became   |
| `binference webhook rotate <rule>` | Gives the rule a new URL; the old one stops at once |
| `binference webhook delete <rule>` | Deletes the rule; its URL stops at once             |

After a rotation, alerts the old URL took that still wait are dropped. You get the
[`webhookRotated`](/reference/notices/#webhookrotated) notice; if you did not rotate it, delete the
rule.

The listener runs on `engine.webhookPort`, 7457 by default. If that port is in use, the engine runs
without it and sends the [`webhookPortTaken`](/reference/notices/#webhookporttaken) notice.

## See also

- [Commands](/reference/commands/) for `expose` and `webhook`.
- [Config keys](/reference/config/) for `remote.*` and `engine.webhookPort`.
- [Auto orders](/guides/auto-orders/) for the other trades that fill without a card.
