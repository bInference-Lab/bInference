# 0398. The gateway makes images on its image endpoint

Status: Accepted

Accepted by the tech lead on 2026-11-07. Amends [decision 0397](../DECISIONS.md#d0397).

## Context

[Decision 0397](0397-the-gateway-makes-images-through-chat-completions.md) asks the gateway's image
models through chat completions. The gateway's documentation names its own image endpoint instead:
`POST /images` makes images with every image model, and `GET /images/models`, which needs no key,
lists them with the fields each takes. Through chat completions the owner's image model answered
with errors about settings binference never sent, and a model that only writes text was taken for
an image model until the call failed.

## Decision

- On a `binference` provider, binference reads `GET /images/models` once per image model and
  sends `POST /images` only the fields that model lists: the number of images up to its most, the
  aspect ratio of the size asked for, quality, output format, background, and the `1K` resolution
  where the model offers tiers. A field the model does not list is left out, since the gateway
  refuses it.
- Images to start from go as data URLs in `input_references`, only to a model that reads images.
  A request over the gateway's 4 MB limit is refused before it is sent, with words that say to
  use fewer or smaller images.
- The images come back as base64 in `data[].b64_json`. A link is never fetched.
- A model the list does not hold is named, with the list the owner picks from, and nothing is
  sent. A failed read of the list is not kept, so the next call reads it again.
- The model client may send a GET of the provider's image model list, besides its model list.
- An `openai` provider keeps OpenAI's Images API.

## Consequences

- The owner makes images with any of the gateway's image models, on the gateway's own key.
- Leaving out quality or resolution would reserve the dearest images; binference asks for about a
  megapixel, the sizes the agent offers.
- The gateway reports each call's cost in dollars and may report no tokens, so an image call can
  book no token usage.

## Alternatives

- **Keep chat completions.** The gateway documents its image endpoint for every image model, and
  some image models refuse the settings a chat request carries.
- **Send every field the agent asks for.** The gateway refuses a field the model does not list.
