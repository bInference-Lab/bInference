# 0380. The owner gets deposit addresses as QR codes the engine reads

Status: Accepted

Accepted by the owner on 2026-11-07.

## Context

Owners fund an agent's wallet from an exchange or a phone wallet, which scan a QR code more
reliably than a person copies 42 characters. Asked for a deposit address and a QR code in chat, the
agent could only answer text, and a model that writes an address can write a wrong one: a planted
instruction in outside content could even make it name an attacker's address.

## Decision

- A QR code only ever holds an address binference read from custody, never text the model wrote.
  The code holds the address alone, as the chain writes it: no `ethereum:` scheme, chain id or
  amount, which some exchange and wallet apps cannot scan.
- `@binference/qr` makes the code's modules and a PNG with no Node built-in, so the Telegram bot
  uploads the image and the console can show the same code later.
- `/wallet` sends each wallet the agent runs from as a photo of its code, captioned with the
  address as code, the network to send on, a warning while the agent trades on paper or is frozen,
  and the explorer link. A launch or bridge wallet nothing runs from gets no code and says to send
  it nothing. A photo Telegram refuses goes as text.
- The agent's `deposit_address` tool takes no arguments. It calls `turn/deposit`, an addition to
  protocol version 1, which reads the wallets as `wallet/list` does and pushes them as
  `chat/deposit` on the agent's chat topic; Telegram shows them as `/wallet` does, and they count
  as the turn's answer. The tool answers the addresses it showed.

## Consequences

- The owner scans or copies an address the engine stands behind, and the model can no longer be the
  source of a deposit address.
- Surfaces that do not show `chat/deposit` yet, the console and terminal chat, still get the
  addresses in the agent's answer.
- The bot uploads files for the first time, at most 10 MB, through the same outbound HTTP.

## Alternatives

- **An `ethereum:<address>@56` link in the code.** Wallets that read it pick the chain, but
  exchanges and many wallets refuse it, and it names Ethereum to a person who reads it.
- **A QR code drawn in text in the message.** Telegram's line spacing breaks the code for most
  scanners.
- **A QR code service's image URL.** It would send the address to a third party, which could also
  answer a different code.
