# 0228. Init declares a model's image input after one live image check

Status: Accepted

Accepted by the owner on 2026-10-16.

## Context

[Decision 0227](0227-an-image-reaches-only-a-model-declared-to-read-it-and-lives-for-one-turn.md)
lets a model read images only when `models.imageInput` names it, default none, so a fresh install
sends every image to `models.vision` or refuses it, even when its main model reads images.
[Decision 0221](0221-init-checks-a-model-key-with-one-small-live-call-before-saving-it.md) has init
check the linked model with one small live call and `binference check` repeat that call; neither
says anything about images. The owner ruled on 2026-10-16 that init declares the linked model's
image input once a live image check passes, and that `binference check` reports whether the main
model reads images.

## Decision

- **The image check.** After the model check of decision 0221 passes, init makes one more call
  through the official client of the provider's kind: one 1x1 PNG in the provider's documented
  format, an `image_url` data URL on Chat Completions and an `image` block with a base64 source on
  Messages, before a short question, with the same output limit as the model check (16 tokens on
  Chat Completions, 1 on Messages). An answer in the API's shape passes.
- **A pass** adds the linked model to `models.imageInput`, and init says so. **A failure** of any
  kind keeps the model out of the list and never blocks init: init says the model gets no images,
  which go to `models.vision` once one is set and are refused until then. The answer's words are
  never shown.
- **`models.images` in `binference check`** reads the config, with no call: the main model reads
  images when `models.imageInput` names it; else images go to the vision model when
  `models.vision` names one; else they are refused, a warning that names `models.vision` and
  `models.imageInput`. `binference check` lists the first two as notes, after its warnings.

## Consequences

- An install whose model reads images gets the owner's images in the model's own turn from init
  on, with no config edit.
- Init spends a second fraction of a cent on the image call.
- A provider that refuses the image for another reason, such as a rate limit, leaves the model out
  of the list; the owner adds it to `models.imageInput` by hand, or runs init again.
- `binference check` shows where images go without spending a call; a model whose image input
  changes at its provider is not found by it.

## Alternatives

- **Declare the model when its provider's model list says it reads images.** Few providers list
  image input per model, and a list does not prove the key, the model and the format together.
- **Ask the owner whether the model reads images.** Most owners cannot know, and a wrong answer
  fails every turn that holds an image.
- **Run the image call in `binference check` too.** It spends a call each run to report what the
  config already declares.
