# 0119. The signer step retries while Privy is unreachable

Status: Accepted

## Context

[Decision 0117](../DECISIONS.md#d0117) runs the engine locked when the signer step fails at start,
and `binference unlock` runs the step again. A background service often starts before the
machine's network is up: Privy's check then fails as `custody_unreachable`, and the engine would
stay locked until the owner unlocked it by hand. Privy's guide asks for an exponential backoff on
429, and the repository's retry module waits with capped exponential backoff and full jitter
([ENGINEERING.md section 7](../ENGINEERING.md#section-7)).

## Decision

- When the signer step at start fails as `custody_unreachable`, the engine retries it by itself
  through the retry module: up to five more attempts, the waits capped at 10, 20, 40, 80 and 160
  seconds, each a random share of its cap, all within five minutes of the first attempt.
- Five minutes covers a machine that joins its network late, such as a laptop on Wi-Fi or a server
  whose router restarts, while a cause that lasts longer needs the owner.
- A retry that succeeds unlocks the engine and announces it as `binference unlock` does. Once the
  retries are spent, the engine stays locked and every surface gets `notice.privyUnreachable`. A
  retry that fails for another reason stops the retries, and the engine stays locked with that
  reason.
- A refused app secret, a signer that fails, or a key that does not match never retries by itself.
  `binference unlock` works at any time; the retries stop once the engine is unlocked, and at
  shutdown.

Accepted by the owner on 2026-10-09.

## Consequences

- Spec 5, section 3 and spec 4 gain the retries and `notice.privyUnreachable`.
- An engine that started without a network unlocks within five minutes of the network's return,
  with nobody at the machine.
- Privy sees at most six checks per start.

## Alternatives

- **Retry forever.** A wrong network setting would hide behind endless checks. Rejected.
- **A fixed wait.** It hits Privy at a steady rate while it is down, against its guide. Rejected.
- **Retry every failure.** A refused secret or a wrong key does not heal by waiting. Rejected.
