<p align="center">
  <img src="docs/odysseus-wordmark.png" alt="IntelDomGob Studio" width="238">
</p>

<p align="center">
  A self-hosted AI workspace for chat, agents, research, documents, email, notes, calendar, and local model workflows.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="docs/setup.md">Setup Guide</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="ROADMAP.md">Roadmap</a>
</p>

<p align="center">
  <img src="docs/odysseus-browser.jpg" alt="IntelDomGob Studio interface">
</p>

---

## Quick Start

> This is IntelDomGob Studio — our fork of the Odysseus AI workspace, distributed
> under AGPL-3.0. The default branch for active development is `dev`; use
> [`main`](https://github.com/EnzoVezzaro/IntelDomGob/tree/main) for the more
> curated, stable branch.

```bash
git clone https://github.com/EnzoVezzaro/IntelDomGob.git
cd IntelDomGob
cp .env.example .env
docker compose up -d --build
```

Open `http://localhost:7000` when the containers are healthy. The first admin password is printed in `docker compose logs odysseus`.

Native installs, GPU notes, Windows/macOS instructions, HTTPS, and configuration live in the [setup guide](docs/setup.md).

## Features

- **Chat + Agents** — local/API models, tools, MCP, files, shell, skills, and memory.
- **Cookbook** — hardware-aware model recommendations, downloads, and serving.
- **Deep Research** — multi-step web research with source reading and report generation.
- **Compare** — blind side-by-side model testing and synthesis.
- **Documents** — writing-first editor with AI edits, suggestions, Markdown, HTML, CSV, and syntax highlighting.
- **Email** — IMAP/SMTP inbox with triage, tags, summaries, reminders, and reply drafts.
- **Notes, Tasks + Calendar** — reminders, todos, scheduled agent tasks, and CalDAV sync.
- **Extras** — gallery/image editor, themes, uploads, web search, presets, sessions, and 2FA.

## Configuration

Copy `.env.example` to `.env` and adjust values as needed. To rebrand the app for
your own deployment, set `APP_NAME` (it drives the product name shown in the UI,
page titles, and notifications). All other configuration is documented in
[`.env.example`](.env.example) and the [setup guide](docs/setup.md).

## Demo

A full hover-to-play tour lives on the landing page: [`docs/index.html`](docs/index.html).

## Contributing

Help is welcome. The best entry points are fresh-install testing, provider setup bugs, mobile/editor polish, docs, and small focused refactors. See [CONTRIBUTING.md](CONTRIBUTING.md) and [ROADMAP.md](ROADMAP.md).

## Security

IntelDomGob Studio is a self-hosted workspace with powerful local tools. Keep auth enabled, keep private data out of Git, and do not expose raw model/service ports publicly. Deployment details are in the [setup guide](docs/setup.md#security-notes).

## Credits

IntelDomGob Studio is a fork of **[Odysseus](https://github.com/pewdiepie-archdaemon/odysseus)**,
a self-hosted AI workspace by the Odysseus authors, distributed under the AGPL-3.0.
The vast majority of this codebase originates from Odysseus. Huge thanks to the
Odysseus authors and contributors — see [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md)
for full attribution.

## License

AGPL-3.0-or-later -- see [LICENSE](LICENSE) and [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md).

This project keeps the same license as its upstream, Odysseus. As an AGPL work,
the complete corresponding source of any network-deployed modified version must
be offered to its users, and the original copyright and license notices are
preserved.

