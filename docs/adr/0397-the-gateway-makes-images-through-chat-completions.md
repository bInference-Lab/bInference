# 0397. The gateway makes images through chat completions

Status: Accepted

Accepted by the tech lead on 2026-11-07. Amends [decision 0392](../DECISIONS.md#d0392).

## Context

[Decision 0392](0392-the-agent-makes-images-in-the-background.md) makes images through OpenAI's
Images API on an `openai` or `binference` provider. The bInference gateway serves no Images API:
`images/generations` answers 404. It serves image models through chat completions instead, as
other model gateways do, and its model list marks the models whose output includes images. The
owner's image requests on the gateway all failed with 404.

## Decision

- On a `binference` provider, an image request is one chat completion: the prompt, and any images
  to start from as data URLs, in one message, with `modalities: ["image", "text"]` and `n` the
  number of images. A Gemini image model also gets the aspect ratio of the size asked for.
- The images come back as data URLs in the message's `images`, or in its content, as text or
  parts. A link to an image elsewhere is never fetched.
- An answer with words and no image says the model likely makes no images, so the owner picks one
  whose output includes images.
- An `openai` provider keeps OpenAI's Images API.

## Consequences

- The owner makes images with any of the gateway's image models, on the gateway's own key.
- A model that only writes text, such as a chat model set as the image model, fails with words
  that say why.

## Alternatives

- **Keep the Images API for every provider.** The gateway does not serve it.
- **Fetch an image link the model sends.** It would reach an address the model chose.
