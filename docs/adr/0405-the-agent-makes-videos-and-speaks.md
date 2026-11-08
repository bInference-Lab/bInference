# 0405. The agent makes videos and speaks

Status: Accepted

Accepted by the lead on 2026-11-08.

## Context

The owner asked for two more tools: videos made on the bInference gateway, such as a short clip
for a token's launch, and the agent's words spoken as a voice note when the owner asks to hear
them. A video takes the gateway 2 to 4 minutes and weighs megabytes, more than a tool call may hold
a turn and more than one line of the control pipe carries, as images did (decision 0392). The
runtime runs under Node's permission model: it writes no file and starts no program, so it cannot
save a video or run the machine's speech programs itself. The gateway serves videos at
`POST /videos` and lists each model's lengths, sizes, shapes, sound, seed, frames and references at
`GET /videos/models`; it serves no speech or music endpoint.

## Decision

- Config migration 21 to 22 adds three keys, unset: `models.videoMaking`, a `<provider>/<model>`
  on a `binference` provider; `models.speech`, a `<provider>/<model>` on an `openai` provider or
  the word `local`; and `speech.voice`, the voice to speak with.
- `make_video` is a control tool, run as `make_image` runs: one job per agent after the call
  answers, `action: "status"`, the cost the gateway charged (`usage.cost`) booked on the turn that
  started it. The runtime reads `GET /videos/models` once per model and sends `POST /videos` only
  values the model lists. When the agent names none, it asks for the model's shortest length and
  lowest size, 16:9 when listed, with no sound, so a video costs the least. Frame images and
  references go only as public `https` links; no file on the machine is uploaded anywhere. Each
  call carries an `Idempotency-Key`. The runtime reads the job every 10 seconds for at most 15
  minutes, then downloads the file from `unsigned_urls` with the key, following one redirect to an
  `https` address without the key. A refused model or value, a failed or expired job, and a
  timeout each end the job in a line the agent reads.
- The video crosses to the engine in parts of 512 KiB through `media/store`, at most 100 MiB, its
  format read from its first bytes, and is saved in the workspace under
  `media/made/<date>/<id>.mp4`. `media/made` pushes `chat/media` and wakes the agent with its path
  or why it failed. `turn.videoComing` closes a turn that started a video and wrote nothing.
- `speak` is a control tool that speaks up to 4,000 characters once the owner asks for voice or
  speech, never as an ordinary reply. On an `openai` provider it calls `POST /audio/speech` for
  Ogg Opus, `speech.voice` or `alloy` as the voice, and stores the audio through `media/store`. With
  `local`, the engine speaks through `speech/local`: on macOS, `say` writes AIFF and `afconvert`
  makes an M4A of AAC, each with an argument array and a 2-minute limit in a folder of the
  workspace removed after it; on Linux and Windows it is refused, naming the setting to set.
  Speech is saved under `media/speech/<date>/`, at most 20 MiB, and pushed by `media/send` with no
  wake-up. The tool names the words it spoke as shown, so the turn's text never repeats them
  (decision 0381).
- `media/read` answers a saved medium in parts of 512 KiB to a surface. Telegram sends a video
  under the Bot API's 50 MB with `sendVideo`, playable in place, a larger one as its path, and
  speech with `sendVoice` as a voice note with no caption. The console plays both from the bytes it
  reads, never from an address. Terminal chat prints the path.
- Neither tool is offered to helpers. Music is left out: the gateway serves no music or speech
  API, and a music provider needs its own key and a plugin of its own.

## Consequences

- The engine holds at most two arriving media and two read ones in memory, each up to 100 MiB, for
  minutes; the default length and size keep a video near a few megabytes.
- A video costs the owner's gateway credit; its charge counts in the day's model budget. Speech on
  an `openai` provider answers no usage, so its cost is not counted in the budget.
- `local` speaks only on macOS. A Linux or Windows owner sets a provider's model to hear the agent.
- Five operations, one push kind and six error codes join protocol version 1 as additions.

## Alternatives

- Writing the video from the runtime: refused, since the runtime holds no file access by design.
- Uploading files on the machine as frame images: refused, since it would put the owner's files on
  a public link without a tap.
- Sending speech as text with an audio file: refused, since the owner would read the same words
  twice.
- Shipping ffmpeg to speak or convert on Linux and Windows: refused, as a large native dependency
  for one tool; a provider's model covers those machines.
