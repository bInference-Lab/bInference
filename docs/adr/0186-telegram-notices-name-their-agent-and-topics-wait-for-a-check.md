# 0186. Telegram notices name their agent, and topics wait for a check

Status: Accepted

Accepted by the owner on 2026-10-12.

## Context

[Spec 2](../specs/config.md#section-6-2) has `telegram.topicsPerAgent`, one topic per agent in the
owner's private chat, on by default. The Bot API lets a bot make topics in a private chat
(`createForumTopic`) and send to one (`message_thread_id`) only when the bot's topic mode is on at
BotFather, which `getMe` reports as `has_topics_enabled`. Whether this works well enough for one
topic per agent is still being checked with a test bot, and the owner has not answered yet. Until
then an owner with several agents must still see which agent a notice is about: the plan's fallback
is the agent's name on every message.

A notice about a ceiling change or a rescue must reach the owner. A topic the bot cannot make, or
one the owner deleted, must not lose it. Telegram answers a send to a deleted topic with a 400
("message thread not found"), which [decision 0133](../DECISIONS.md#d0133) would fail for good.

## Decision

- **Off by default.** `telegram.topicsPerAgent` defaults to `false` until the check passes and the
  owner says so. It is read for each notice, so a change in config.json5 applies to the next one.
- **Topics when they work.** With the setting on, the outbox asks `getMe` once. When the bot has
  topics in private chats, a notice about an agent goes to the agent's topic, made the first time
  with the agent's name and kept in `telegram_topics` (migration 0030), so a restart keeps it. A
  notice that names no agent goes to the chat itself. When the bot has no topics, a warning is
  logged once and notices go as with the setting off.
- **The agent's name otherwise.** Without a topic, a notice about an agent whose words do not name
  the agent starts with its name: `telegram.notice.agent`, "{agent} · {notice}", in both languages.
- **Making a topic.** The topic is made before the delivery is claimed, so a failure sends nothing.
  A refusal that may pass, or a call whose answer was lost, waits out the backoff of decision 0133
  and holds the line. A refusal for good logs `telegram.topic_failed`, and the notice goes to the
  chat itself with the agent's name: a security notice in the wrong place is better than none.
- **A deleted topic.** A send that Telegram refuses because the topic is gone forgets the agent's
  topic and puts the delivery back in the queue after its backoff; the next attempt makes a new
  topic. Telegram sent nothing, so the notice still goes once.

## Consequences

- One agent's owner sees no change but the name before some notices; with several agents, each
  notice says whose it is.
- Turning topics on later needs no migration: the first notice of each agent makes its topic.
- Spec 2's default changes to `false`; spec 3 gains `telegram_topics`; spec 4 gains
  `telegram.notice.agent`. The agent's chat and its cards keep their own place until the agent
  commands land.
- The synthetic Bot API gains topics in private chats, so every path is proven without a live bot.

## Alternatives

- **Keep the default on.** Untested topic mode would decide where security notices land. Rejected.
- **Retry a refused topic forever.** A bot whose topic mode is off at BotFather would hold every
  notice behind it. Rejected.
- **Fail a send to a deleted topic, as decision 0133 fails any 400.** The notice would be lost
  for a topic the owner removed. Rejected.
- **The agent's name on every notice.** Notices such as "main is frozen" would name it twice.
  Rejected.
