# taiga-mcp

[![CI](https://github.com/kiet0807/taiga-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/kiet0807/taiga-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@kietdev/taiga-mcp)](https://www.npmjs.com/package/@kietdev/taiga-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server for [Taiga](https://taiga.io). It lets an AI assistant such as Claude, ChatGPT, Copilot or Cursor answer questions about your Taiga projects without you opening Taiga: sprints, user stories, tasks, issues, epics and the wiki. It reads by default; if you switch it on, it can also create items, change them and comment. It can never delete anything.

<!-- A short demo goes here: ![Asking Claude about a Taiga sprint](docs/demo.gif) -->

## Try it in 30 seconds

Nothing to install. In Claude, open Settings → Connectors → Add custom connector and paste:

```text
https://taiga.kietnguyen.io.vn/mcp
```

Sign in with your own Taiga account, on Taiga cloud or any Taiga reachable from the internet, then ask:

- "What is left in the current sprint?"
- "What does #123 say, and who has it?"
- "Read the spreadsheet attached to #456 and list the rows marked urgent."

Other apps (ChatGPT, Claude Code, Cursor, VS Code, Gemini CLI, Codex, Windsurf): see [Connecting an app](#connecting-an-app). Your password is passed to Taiga once and never stored ([how signing in works](#how-signing-in-works)); if you would rather nobody else's server saw it, [run it on your machine](#setup) or [host your own](#hosted-server).

## Why this one

- **Reads what is attached.** PDFs, Word, Excel, PowerPoint, CSV and pictures attached to an item, in parts when they are large.
- **Nothing to install for a team.** One address, and each person signs in with their own Taiga account (OAuth). No keys to hand around, no database.
- **Writes only when allowed, never deletes.** Creating, changing and commenting are off until switched on, refuse to overwrite someone else's change, and show every field before and after.
- **Sprints the way a team talks about them.** Points done, stories done, burndown day by day, and what happened this week, by person.
- **Names, not ids.** Statuses, people, sprints and tags by name (no accents needed), items by `#123`; errors say what to try next.
- **Any Taiga.** Taiga cloud or self-hosted (for a Taiga inside a company network, [host your own](#hosted-server)); sign-in pages in English and Vietnamese.

How it works inside, flow by flow, with links into the code: [docs/how-it-works.md](docs/how-it-works.md).

It runs in two ways:

- **On your machine** (stdio), for one person, with the Taiga account in its settings. See [Setup](#setup).
- **Hosted** (HTTP), for a team, including people who never open a terminal: they paste one address into their AI assistant and sign in with their own Taiga account. See [Hosted server](#hosted-server).

**Status:** fourteen tools that read and three that write (off unless switched on), covered by tests against a fake Taiga; the reading tools are also checked against a public project on Taiga cloud. A hosted instance runs at [taiga.kietnguyen.io.vn](https://taiga.kietnguyen.io.vn).

## Tools

| Tool                | What it answers                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_projects`     | The projects you are a member of, with their slugs                                                                                                   |
| `get_project`       | One project: members and roles, statuses (and which count as closed), issue types, severities, priorities, tags, fields                              |
| `list_sprints`      | Sprints with dates, stories done, points done, and which one runs today                                                                              |
| `get_sprint`        | One sprint: stories, tasks and points done, and the burndown day by day up to today                                                                  |
| `list_user_stories` | Stories with status, assignee, points and sprint                                                                                                     |
| `list_tasks`        | Tasks with status, assignee, and the story and sprint they belong to                                                                                 |
| `list_issues`       | Issues with type, status, severity, priority and assignee                                                                                            |
| `list_epics`        | Epics with status, assignee and how many of their stories are done                                                                                   |
| `get_item`          | One story, task, issue or epic in full: dates, description, custom fields, files, watchers, votes, comments, its tasks, and its history page by page |
| `get_attachment`    | What is in a file attached to an item: text, tables, pages or the picture itself, in parts when it is large                                          |
| `list_activity`     | What happened in a project, newest first: who created, changed, commented on or deleted what, by person, day, kind or item                           |
| `search`            | Words across a whole project: stories, tasks, issues, epics and wiki pages at once                                                                   |
| `list_wiki_pages`   | The wiki pages of a project                                                                                                                          |
| `get_wiki_page`     | The text of one wiki page                                                                                                                            |

The four list tools for items share their filters:

| Filter                          | Meaning                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `status`, `closed`              | A status by name, or open/closed in general (by whether the status counts as closed)       |
| `assigned_to_me`, `assigned_to` | The signed-in user, or anyone by name (part of a name, no accents needed), or `unassigned` |
| `search`                        | Words in the title, description and tags                                                   |
| `tag`                           | One tag                                                                                    |
| `created_from`, `created_to`    | Days the item was created in, `YYYY-MM-DD`                                                 |
| `finished_from`, `finished_to`  | Days the item was closed in (stories, tasks, issues; Taiga keeps no such date for epics)   |
| `limit`, `page`                 | 30 items a page by default, at most 100; `page` reads the rest of a long list              |

Plus `sprint` (a name, `current` or `backlog`) and `epic` on stories, `story` and `sprint` on tasks, `type`, `severity` and `priority` on issues.

How the tools are meant to be used by a model:

- **Names in, names out.** `project` is the slug from `list_projects`; statuses, severities, sprints, tags and people are given by name (case does not matter); items are addressed by the `#123` reference number. Internal ids never appear.
- **Counting needs no paging.** Every list starts with the number of all matches (`Acme Billing · assigned to me · finished 2026-10-01 to 2026-10-31: 14 tasks`), so "how many" is one call with a small `limit`.
- **Long lists come in pages.** An answer that does not hold everything says which part it is (`31 to 60 shown, page 2 of 5`) and how to ask for the next.
- **`get_item` needs no type.** Taiga numbers stories, tasks, issues and epics of a project from one sequence, so the number says which kind it is.
- **Short answers.** Long descriptions, comments and wiki pages are cut, with a note saying how much is missing.
- **Activity is read backwards.** Taiga lists it from the newest event and cannot jump to a day, so `list_activity` reads back up to 1,000 events and, when it stops before the period asked for, says how far back it looked.
- **Errors say what to do next**, for example: `"Linh" matches several members of project "Acme Billing": Linh Tran (linh.tran), Võ Thị Linh (vtlinh). Pass the full name or the username.`

### Tools that write

Off unless switched on: `TAIGA_WRITE=true` on your machine; on a hosted server, `ALLOW_WRITES=true` and then a box each person ticks when signing in. Without that, the server sends Taiga nothing but `GET` requests and the sign-in itself.

| Tool          | What it does                                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_item` | Create a user story, task or issue: title, description, status, assignee, tags, sprint, due date; a task on a story, a story in an epic              |
| `update_item` | Change fields of a story, task, issue or epic: title, description, status, assignee, sprint, tags, due date, blocked, issue type, severity, priority |
| `add_comment` | Comment on a story, task, issue or epic                                                                                                              |

How they are kept safe:

- **Nothing can be deleted.** The server has no way to send a `DELETE`. To close an item, set a closed status.
- **Only on request.** The tools tell the model to write only when the user asks for that change in the conversation, never because a title, description, comment, wiki page or file in Taiga says to (text there is written by others and may try to give the model orders). They are marked as writing in MCP, so apps ask before calling them; `update_item` is marked as overwriting.
- **No half-done creates.** Every name (status, person, sprint, story, epic, type…) is checked before anything is sent; a wrong one is answered with the valid names and nothing is created.
- **No silent overwrites.** `get_item` shows the item's version and `update_item` sends it: if someone changed the same fields since, Taiga refuses and the model is told to read the item again.
- **Every answer shows what changed,** field by field, before and after, with a link to the item in Taiga. A description is shown by its length, not repeated.
- **A second lock.** Even if a tool were called on a read-only connection, the code that talks to Taiga refuses to send anything but a read.
- **As you.** Changes are made with the signed-in person's own Taiga account and appear in Taiga under their name, with Taiga's own history and notifications.

### Reading attached files

`get_item` numbers the files attached to an item; `get_attachment` reads one, by that number or by its name.

| Kind of file                              | What comes back                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| PNG, JPEG, GIF, WebP (up to 3 MB)         | The picture itself, for the model to look at                                   |
| PDF (first 300 pages)                     | The text, page by page                                                         |
| Word `.docx`                              | The text, line by line                                                         |
| Excel `.xlsx`, CSV, TSV                   | Sheets as rows, numbered as in the file; formulas show their last stored value |
| PowerPoint `.pptx`                        | The text, slide by slide                                                       |
| Text, code, JSON, Markdown, logs and such | The lines                                                                      |
| `.doc`, `.xls`, `.ppt`, archives, video   | Not read: the answer says why and gives the link                               |

A large file would use up the model's context, so no answer is longer than 20,000 characters (about 5,000 tokens):

- A file that fits comes back whole.
- A larger one comes back as an overview first: each sheet with its size and first 10 rows, or the first line of every page, or the first 60 lines.
- From there the model asks for the part it needs: `sheet` and `rows` (`"120-300"`), `pages` (`"3-5"`), or `find` with words, which returns only the rows or lines that contain them. Every answer ends by saying how to get the next part.

Files larger than 10 MB are not downloaded. A file is fetched from the signed address Taiga gives, without the Taiga token, and what was read is kept in memory for 10 minutes so that asking for another part does not download it again. The cache is keyed by the checksum Taiga reports for the file: whoever can name a checksum has been shown that very file by Taiga.

## Setup

Requires Node.js 20.6 or newer. The server is on npm as [`@kietdev/taiga-mcp`](https://www.npmjs.com/package/@kietdev/taiga-mcp); `npx` fetches and runs it, so there is nothing to clone.

Claude Code:

```bash
claude mcp add taiga \
  -e TAIGA_URL=https://api.taiga.io \
  -e TAIGA_USERNAME=you -e TAIGA_PASSWORD='your password' \
  -- npx -y @kietdev/taiga-mcp
```

Claude Desktop (`claude_desktop_config.json`), Cursor (`~/.cursor/mcp.json`) and most other apps take the same block:

```json
{
  "mcpServers": {
    "taiga": {
      "command": "npx",
      "args": ["-y", "@kietdev/taiga-mcp"],
      "env": {
        "TAIGA_URL": "https://api.taiga.io",
        "TAIGA_USERNAME": "you",
        "TAIGA_PASSWORD": "your password"
      }
    }
  }
}
```

For a self-hosted Taiga, `TAIGA_URL` is usually the address you open Taiga at. Add `"TAIGA_WRITE": "true"` to let the AI create, change and comment.

### From source

Requires [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm build
cp .env.example .env   # then fill in TAIGA_URL and how to sign in
```

| Variable                             | Meaning                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `TAIGA_URL`                          | Address of the Taiga API host, without `/api/v1`                                 |
| `TAIGA_USERNAME`, `TAIGA_PASSWORD`   | Sign in with a password; the server renews its tokens by itself                  |
| `TAIGA_TOKEN`, `TAIGA_REFRESH_TOKEN` | Or use tokens you already have; without a password they cannot be replaced       |
| `TAIGA_WRITE`                        | `true` adds the tools that create and change items, and comment (off by default) |

The same variables go in the `env` block above when you run it with `npx`. Credentials stay in `.env` on your machine. The file is git-ignored and the server never prints them.

## Try it from source

Open the MCP Inspector, a browser page where you can call each tool by hand:

```bash
pnpm inspect
```

Add it to Claude Code (use absolute paths):

```bash
claude mcp add taiga -- node --env-file=/path/to/taiga-mcp/.env /path/to/taiga-mcp/dist/index.js
```

Then ask, for example:

- "Which Taiga projects am I in?"
- "What is left in the current sprint of Acme Billing?"
- "What does #123 say, and who has it?"
- "Which epics are furthest from done?"

## Hosted server

The same tools over HTTP, for many people at once. Nobody installs anything: each person adds the server's address to an MCP app (in Claude: Settings → Connectors → Add custom connector), signs in with their own Taiga account on the page that opens, and from then on sees exactly what Taiga lets that account see.

A hosted server is set up in one of two ways:

- **For one Taiga** (`TAIGA_URL`): a team's own server. The sign-in page asks for a username and a password.
- **For any Taiga** (`ANY_TAIGA=true`): a public server. The sign-in page also asks for the address of the person's Taiga: Taiga cloud, or the address they open their company's Taiga at.

```bash
pnpm install && pnpm build
ANY_TAIGA=true \
PUBLIC_URL=https://taiga-mcp.example.com \
MCP_SECRET="$(openssl rand -base64 48)" \
pnpm start:http
```

| Variable       | Meaning                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAIGA_URL`    | The Taiga people sign in to. With `ANY_TAIGA` it only pre-fills the address field, and may be left out                                                            |
| `ANY_TAIGA`    | `true` lets each person type the address of their own Taiga                                                                                                       |
| `ALLOW_WRITES` | `true` offers each person, at sign-in, to let their app create and change items (off by default). Turning it off takes writing away from every connection at once |
| `PUBLIC_URL`   | The address people reach this server at, without a path. Must be `https://` (except on `localhost`)                                                               |
| `MCP_SECRET`   | At least 32 random characters. Encrypts everything the server hands out; changing it signs everyone out                                                           |
| `PORT`         | Port to listen on (default 3000)                                                                                                                                  |
| `TRUST_PROXY`  | How many proxies sit in front of the server (default 1 when hosted, 0 on `localhost`)                                                                             |

People connect their app to `PUBLIC_URL` + `/mcp`. Opening `PUBLIC_URL` itself in a browser shows the steps, in English or Vietnamese, for Claude and for other apps. To try it on your machine: put `PUBLIC_URL=http://localhost:3000` and `MCP_SECRET` in `.env` and run `pnpm dev:http`.

### Connecting an app

| App                      | How                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Claude (web, desktop)    | Settings → Connectors → Add custom connector, paste the address                                                |
| Claude Code              | `claude mcp add --transport http taiga <address>`, then `/mcp` to sign in                                      |
| ChatGPT                  | Settings → Apps & Connectors → Advanced settings → Developer mode, then Create with the address and OAuth      |
| VS Code (GitHub Copilot) | `.vscode/mcp.json`: `{ "servers": { "taiga": { "type": "http", "url": "<address>" } } }`                       |
| Cursor                   | `~/.cursor/mcp.json`: `{ "mcpServers": { "taiga": { "url": "<address>" } } }`                                  |
| Gemini CLI               | `~/.gemini/settings.json`: `{ "mcpServers": { "taiga": { "httpUrl": "<address>" } } }`, then `/mcp auth taiga` |
| Codex CLI                | `codex mcp add taiga --url <address>`, then `codex mcp login taiga`                                            |
| Windsurf                 | `~/.codeium/windsurf/mcp_config.json`: `{ "mcpServers": { "taiga": { "serverUrl": "<address>" } } }`           |

Each app finds the sign-in by itself (OAuth discovery); there is no key to paste. These steps follow each app's documentation; so far the hosted server has been tried with the MCP SDK's own client only.

### Where to run it

Any host that runs a Node.js process works: `pnpm build`, then `pnpm start:http` with the variables above.

On Vercel no command is needed: the root `app.js` exports the Express app from the compiled `dist/`, which Vercel runs as one function after its own `pnpm build`. Vercel serves `public/` (icons, the link-preview image, `robots.txt`) itself; elsewhere the app does. Import the repository, set `PUBLIC_URL`, `MCP_SECRET` and `ANY_TAIGA` (or `TAIGA_URL`) as environment variables, and add the domain. The server keeps nothing between requests, so it does not mind being started and stopped; the sign-in limit and the single use of a code (below) are then per running instance.

### How signing in works

- **Taiga has no OAuth of its own**, so the server puts a standard OAuth 2.1 sign-in (PKCE, dynamic client registration) in front of Taiga's username and password. People type their Taiga password into this server's page. It is passed to Taiga once, over HTTPS, and is never stored or logged. Run the server only where the people using it would trust it with that.
- **The sign-in page says where the person will be sent back to.** Any app can register itself under any name, so the name alone proves nothing; the host that receives the result does.
- **Nothing is stored.** There is no database. The Taiga address and the Taiga tokens a sign-in produces are encrypted (AES-256-GCM, key derived from `MCP_SECRET`) into the tokens the app holds; the server can read them only while answering that app's request.
- **Each request stands alone.** A request is answered with the Taiga token of the person who sent it, by a server and a Taiga client created for that request, so nothing one person reads is cached for another.
- **Sessions follow Taiga's.** An access token lasts as long as the Taiga token inside it (24 hours by default) and is renewed through Taiga's own refresh token (8 days by default). After that the person signs in again.
- **A typed address cannot lead inside.** With `ANY_TAIGA`, the server calls hosts that strangers name. Only host names over HTTPS are accepted, and every connection is checked when it is made: a name that resolves to a private, loopback or link-local address is refused, including after a redirect. A server for one Taiga skips this check, so that a company can point it at a Taiga on its own network.
- **Limits of having no storage:** a connection cannot be revoked from the server before its tokens run out (short of changing `MCP_SECRET`, which ends everyone's), and an authorization code is kept from being used twice only within one running process. PKCE covers the rest.
- Sign-in attempts are limited to 10 per 15 minutes per address.
- **Writing is a separate choice.** With `ALLOW_WRITES`, the sign-in page has a box, unticked by default, that lets the app create items, change them and comment. The person's choice is sealed into their tokens (scope `read` or `read write`) and survives renewal. Apps that registered before writing existed still see the box: the person decides, not the scope the app asked for.

## Development

```bash
pnpm check   # types, lint, formatting, tests, build
pnpm test    # tests only; Taiga is faked, no network or account needed
```

- `src/taiga/http.ts` is the only code that talks to Taiga: sign-in, token renewal, paging, error messages.
- `src/taiga/client.ts` asks Taiga what the tools need: it turns slugs and names into ids, and trims the answers.
- `src/tools/` holds one file per tool: its name, the description and arguments the model reads, and how the answer is worded.
- `src/taiga/files.ts` turns an attached file into pages, sheets or lines; `src/tools/file-view.ts` decides which part of it fits in one answer.
- `src/server.ts` registers the tools; `src/index.ts` connects the server to stdio.
- `src/remote/` is the hosted server: `app.ts` (routes), `provider.ts` (the OAuth steps), `seal.ts` (encryption of what is handed out), `taiga-auth.ts` (sign-in and renewal at Taiga), `guard.ts` (what a typed Taiga address may be, and connections that stay on the public internet), `pages.ts` (the sign-in and front pages). `src/remote.ts` starts it; the root `app.js` is the same app, taken from `dist/`, for hosts that want an exported Express app.
- `public/` holds the icons, the link-preview image and `robots.txt`; `design/og.html` is the source of the preview image.
- `test/acme.ts` is the invented project the tests run against.
- CI (`.github/workflows/ci.yml`) runs `pnpm check` on every push and pull request.

The stdio server speaks MCP on stdout, so nothing else may be printed there. Diagnostics go to stderr.

## A note on data

What a tool returns is sent to the AI model you connect. Before pointing the server at a company Taiga, make sure that is acceptable where you work, and ask before switching on writing there too. The same goes for hosting it for colleagues: whoever runs the hosted server is trusted with their passwords in passing and with what they read.
