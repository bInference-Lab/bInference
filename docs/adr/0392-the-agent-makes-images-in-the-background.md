# 0392. The agent makes images in the background

Status: Accepted

Accepted by the lead on 2026-11-07.

## Context

The owner asked for the agent's tools to cover making images, such as a token's logo before a
launch or a chart styled for a post. An image model takes from a few seconds to minutes, longer
than a tool call may hold a turn, and its output is several megabytes: more than one line of the
control pipe between the engine and the runtime carries.

## Decision

- `models.imageMaking` names the model that makes images, `<provider>/<model>`, on a provider of
  `models.providers` that speaks OpenAI's Images API (`openai` or `binference`). Config migration
  19 to 20 adds it, unset. Without it, the tool says which setting to set.
- The agent gets `make_image`, a control tool: a prompt, 1 to 4 images, a size, a quality, an
  output format (PNG unless asked), a background, and up to 4 reference images named as
  `look_at_image` names them, which turn the call into an edit. `action: "status"` answers the job
  that runs. One job runs per agent: a second call while one runs answers that job.
- The runtime runs the job after the call answers, so the turn ends with a short line; the model's
  client is built in `src/providers/` as every other. The job's cost goes through `usage/record`
  on the turn that started it, so the day's budget counts it.
- Each made image crosses to the engine in parts of 512 KiB through `image/store`, at most 5 MiB
  an image, its format read from its first bytes. The engine saves it in the agent's workspace
  under `media/made/<date>/`, and answers an id. `image/made` then pushes `chat/images` on the
  agent's chat topic, with each image's id, format, size and path, and wakes the agent with a
  message from the engine that says the images are ready, or why making them failed. `image/read`
  answers a made image's parts, by id, to a surface with `read`.
- The console draws the images; Telegram sends each as a photo; terminal chat prints where each
  was saved. The agent never sends a made image anywhere itself.
- All three operations are additions to protocol version 1. `image/store` and `image/made` answer
  only the engine's current runtime, and none keeps an idempotency record, so no image's bytes are
  stored twice.

## Consequences

- A made image outlives the chat: it stays in the workspace for the owner, and the agent can look
  at it again through its path.
- The engine keeps the ids of the last 64 made images in memory; after a restart the files remain,
  but a surface cannot read an older one by id.
- An image over 5 MiB is refused; the agent can ask again for JPEG or WebP.

## Alternatives

- **Hold the turn until the images arrive.** A tool call gets 60 seconds, and many image models
  take longer.
- **Have the engine call the image model.** Model clients live only in the runtime, which holds no
  key the engine needs and keeps the trust boundary small.
- **Wake the agent with a new inbox kind.** Both databases check the kinds, so it would need two
  table rebuilds for what a message from the engine already carries.
