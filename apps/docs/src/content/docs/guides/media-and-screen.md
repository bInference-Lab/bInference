---
title: Pictures, videos, voice and the screen
description: Let the agent make images and videos, speak, show pictures, send files, read PDFs and look at your screen.
---

The agent can make images and videos, speak to you, show you pictures and files that are on the
machine, read PDFs, and look at your screen when you ask. What it makes is saved in the workspace
folder, `workspace/` in binference's state folder, and shows in the chat on every surface.

## Images the agent makes

`make_image` makes 1 to 4 images from a prompt, such as a token's logo, or edits up to 4 images you
name. It needs `models.imageMaking`, a model written as `<provider>/<model>`:

- on a `binference` provider, one of the bInference gateway's image models; binference sends each
  model only the settings it takes
- on an `openai` provider, a model of OpenAI's Images API

```sh
binference config set models.imageMaking binference/<model>
```

Without it, the agent says which setting to set. The agent starts the job and ends its turn; the
images arrive in the chat a little later, up to a few minutes. Telegram sends each as a photo, the
console draws it, and the terminal chat prints where it was saved, under `media/made/<date>/` in
the workspace folder. One job runs per agent at a time, and what it costs counts against the
agent's model budget.

## Videos

`make_video` makes one short video with `models.videoMaking`, one of the bInference gateway's video
models. When you name no length, size or sound, the agent asks for the model's shortest length and
lowest size, at 16:9 and without sound, which cost the least. Pictures for the first and last frame,
and references to keep a look, go only as public `https` links: no file on your machine is uploaded.

A video takes a few minutes, at most 15. It is saved under `media/made/<date>/`, up to 100 MiB, and
its cost counts against the model budget. Telegram plays a video under 50 MB in place and sends the
path of a larger one; the console plays it.

## Voice

`speak` speaks up to 4,000 characters as a voice note, only when you ask to hear something.
`models.speech` names what speaks:

- a speech model on an `openai` provider; `speech.voice` picks one of its voices, `alloy` by default
- `local`, the machine's own voice on macOS; `speech.voice` picks one of its voices, such as
  `Samantha`. On Linux and Windows, `local` is refused.

Telegram sends a voice note, the console plays it, and the terminal chat prints where it is saved,
under `media/speech/<date>/`.

## Showing pictures and sending files

- `show_images` shows up to 12 pictures already on the machine, such as images the agent made
  before or a screenshot: PNG, JPEG or WebP files of at most 5 MiB, up to 4 in a message. Telegram
  sends them as photos, each captioned with where it is saved.
- `send_files` sends up to 10 files of any kind, at most 20 MiB each, as documents you keep.
  Telegram sends them as documents, the console lists each with a Save button, and the terminal chat
  prints where each is.

Both read files as the [file tools](/guides/shell-and-files/#the-file-tools) do: never in
binference's own folder, and only in the workspace folder while `files.workspaceOnly` is `true`.

## Pictures and PDFs

- `look_at_image` describes up to 4 images at a public address or in files on the machine, at most
  5 MiB each.
- `read_pdf` reads up to 10 PDFs at a public address or on the machine, at most 10 MiB each, and
  answers what the agent asks about them. It reads 20 pages a call, the first 20 unless the agent
  names others, and up to 100,000 characters of text. A scanned page, one with little text, is read
  from its picture by the chat's model when `models.imageInput` lists it, else by `models.vision`;
  with neither, the answer names the pages left unread. For an encrypted PDF the agent asks you for
  the password, which binference never logs or keeps.

An address is read only on the public internet, through your proxy when you set one. What a picture
or a PDF holds is outside content, so the chat is marked as after a web page.

## Looking at your screen

`look_at_screen` takes a screenshot of the machine's screen and describes it, only when you ask the
agent to look. It only looks: nothing in binference moves the mouse, clicks, types or controls an
app, so the agent tells you what to do there. Each screenshot is saved under `media/screen/<date>/`,
and the agent shows it to you when you ask. What the screen shows is outside content, and the agent
never repeats a password, a key or a recovery phrase it sees.

- **macOS** asks for the permission the first time, and no screenshot is taken until you allow it.
  Open System Settings, Privacy and Security, Screen Recording, and turn on the program the agent
  names: the Node program binference runs on, or the terminal app that started binference. Then
  restart binference with `binference stop` and `binference start`.
- **Linux** needs a desktop session and one of `grim`, `gnome-screenshot` or `scrot`.
- **Windows** takes the screenshot with a fixed PowerShell script.

A machine with no screen, such as a server or a container, has nothing to look at. A screenshot
over 5 MiB is made smaller before the agent reads it; `gnome-screenshot` cannot make one smaller,
so there such a screenshot is refused.

## See also

- [Config keys](/reference/config/) for `models.imageMaking`, `models.videoMaking`,
  `models.speech`, `speech.voice`, `models.vision` and `models.imageInput`.
- [Agent and MCP tools](/reference/agent-and-mcp-tools/) for every tool on this page.
- [Chat with your agent](/guides/chat/) for the model budget.
