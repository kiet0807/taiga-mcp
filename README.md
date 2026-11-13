# taiga-mcp

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server for [Taiga](https://taiga.io). It lets an AI assistant such as Claude, ChatGPT, Copilot or Cursor answer questions about your Taiga projects without you opening Taiga: sprints, user stories, tasks, issues, epics and the wiki.

It runs in two ways:

- **On your machine** (stdio), for one person, with the Taiga account in a local `.env` file. See [Setup](#setup).
- **Hosted** (HTTP), for a team, including people who never open a terminal: they paste one address into their AI assistant and sign in with their own Taiga account. See [Hosted server](#hosted-server).

**Status:** eleven read-only tools, covered by tests against a fake Taiga and checked against a public project on Taiga cloud. A hosted instance runs at [taiga.kietnguyen.io.vn](https://taiga.kietnguyen.io.vn). Not published to npm.

## Tools

| Tool                | What it answers                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `list_projects`     | The projects you are a member of, with their slugs                                                                      |
| `get_project`       | One project: members and roles, statuses (and which count as closed), issue types, severities, priorities, tags, fields |
| `list_sprints`      | Sprints with dates, stories done, points done, and which one runs today                                                 |
| `list_user_stories` | Stories with status, assignee, points and sprint                                                                        |
| `list_tasks`        | Tasks with status, assignee, and the story and sprint they belong to                                                    |
| `list_issues`       | Issues with type, status, severity, priority and assignee                                                               |
| `list_epics`        | Epics with status, assignee and how many of their stories are done                                                      |
| `get_item`          | One story, task, issue or epic in full: dates, description, custom fields, files, comments, its tasks, its history      |
| `search`            | Words across a whole project: stories, tasks, issues, epics and wiki pages at once                                      |
| `list_wiki_pages`   | The wiki pages of a project                                                                                             |
| `get_wiki_page`     | The text of one wiki page                                                                                               |

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
- **Errors say what to do next**, for example: `"Linh" matches several members of project "Acme Billing": Linh Tran (linh.tran), Võ Thị Linh (vtlinh). Pass the full name or the username.`

Every tool only reads. The server sends `GET` requests to Taiga, plus the sign-in itself.

## Setup

Requires Node.js 20.6 or newer and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm build
cp .env.example .env   # then fill in TAIGA_URL and how to sign in
```

| Variable                             | Meaning                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `TAIGA_URL`                          | Address of the Taiga API host, without `/api/v1`                           |
| `TAIGA_USERNAME`, `TAIGA_PASSWORD`   | Sign in with a password; the server renews its tokens by itself            |
| `TAIGA_TOKEN`, `TAIGA_REFRESH_TOKEN` | Or use tokens you already have; without a password they cannot be replaced |

Credentials stay in `.env` on your machine. The file is git-ignored and the server never prints them.

## Try it

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

The same six tools over HTTP, for many people at once. Nobody installs anything: each person adds the server's address to an MCP app (in Claude: Settings → Connectors → Add custom connector), signs in with their own Taiga account on the page that opens, and from then on sees exactly what Taiga lets that account see.

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

| Variable      | Meaning                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| `TAIGA_URL`   | The Taiga people sign in to. With `ANY_TAIGA` it only pre-fills the address field, and may be left out  |
| `ANY_TAIGA`   | `true` lets each person type the address of their own Taiga                                             |
| `PUBLIC_URL`  | The address people reach this server at, without a path. Must be `https://` (except on `localhost`)     |
| `MCP_SECRET`  | At least 32 random characters. Encrypts everything the server hands out; changing it signs everyone out |
| `PORT`        | Port to listen on (default 3000)                                                                        |
| `TRUST_PROXY` | How many proxies sit in front of the server (default 1 when hosted, 0 on `localhost`)                   |

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

## Development

```bash
pnpm check   # types, lint, formatting, tests, build
pnpm test    # tests only; Taiga is faked, no network or account needed
```

- `src/taiga/http.ts` is the only code that talks to Taiga: sign-in, token renewal, paging, error messages.
- `src/taiga/client.ts` asks Taiga what the tools need: it turns slugs and names into ids, and trims the answers.
- `src/tools/` holds one file per tool: its name, the description and arguments the model reads, and how the answer is worded.
- `src/server.ts` registers the tools; `src/index.ts` connects the server to stdio.
- `src/remote/` is the hosted server: `app.ts` (routes), `provider.ts` (the OAuth steps), `seal.ts` (encryption of what is handed out), `taiga-auth.ts` (sign-in and renewal at Taiga), `guard.ts` (what a typed Taiga address may be, and connections that stay on the public internet), `pages.ts` (the sign-in and front pages). `src/remote.ts` starts it; the root `app.js` is the same app, taken from `dist/`, for hosts that want an exported Express app.
- `public/` holds the icons, the link-preview image and `robots.txt`; `design/og.html` is the source of the preview image.
- `test/acme.ts` is the invented project the tests run against.
- CI (`.github/workflows/ci.yml`) runs `pnpm check` on every push and pull request.

The stdio server speaks MCP on stdout, so nothing else may be printed there. Diagnostics go to stderr.

## A note on data

What a tool returns is sent to the AI model you connect. Before pointing the server at a company Taiga, make sure that is acceptable where you work. The same goes for hosting it for colleagues: whoever runs the hosted server is trusted with their passwords in passing and with what they read.
