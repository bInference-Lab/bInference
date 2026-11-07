# 0399. The agent shows images already on the machine

Status: Accepted

Accepted by the tech lead on 2026-11-07.

## Context

The owner asked the agent to show every image it had made. The agent could make images
([decision 0392](0392-the-agent-makes-images-in-the-background.md)) and look at one
([decision 0385](0385-the-agent-looks-at-an-image-by-its-address-or-file.md)), but it could not
send a picture that already exists to the chat. It made a new collage of the old images instead,
which changed them, and its turn wrote no text, so Telegram said no response was generated while
the collage was on its way.

## Decision

- The agent gets `show_images`, a control tool: up to 12 images already on the machine, by path,
  with a short caption. The engine's `image/show` reads each as `image/view` reads a path, so
  binference's own folder stays walled off and `files.workspaceOnly` holds, and pushes them as
  `chat/images`, up to 4 a message. Every surface shows them as it shows made images: Telegram as
  photos captioned with where each is saved.
- The images of one message must all read before any is shown; a refusal names its code, and the
  agent hears which images the owner already sees.
- A shown image is read again where it is when a surface asks for its bytes, never copied.
- `make_image` tells the agent to show images that exist with `show_images`, never to make them
  again.
- A turn that started an image job and wrote no text ends with `turn.imageComing` or
  `turn.imagesComing`, so the owner never reads that no response came while images are on their
  way.

## Consequences

- The owner sees images the agent made earlier, and any picture on the machine the agent finds,
  in the chat.
- A shown image whose file moves or goes cannot be read again; the surface shows its path.

## Alternatives

- **Copy each shown image into the workspace.** It would fill the workspace with copies.
- **Let `make_image` take existing images as its output.** It would mix making and showing in one
  tool and spend the image model's money on nothing.
