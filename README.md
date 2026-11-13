# taiga-mcp

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server for [Taiga](https://taiga.io). It lets an AI assistant such as Claude Code answer questions about your Taiga projects without you opening Taiga.

**Status: all six tools of the first version work** and are covered by tests against a fake Taiga. Not yet published to npm.

## Tools

| Tool                | Arguments                                                                              | What it returns                                                             |
| ------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `list_projects`     | none                                                                                   | Projects you are a member of, with name and slug                            |
| `list_sprints`      | `project`, `closed?`, `limit?`                                                         | Sprints with dates, story count, points done, and which one runs today      |
| `list_user_stories` | `project`, `sprint?`, `status?`, `closed?`, `assigned_to_me?`, `limit?`                | Stories with status, assignee, points and sprint                            |
| `list_issues`       | `project`, `status?`, `closed?`, `severity?`, `priority?`, `assigned_to_me?`, `limit?` | Issues with type, status, severity, priority and assignee                   |
| `list_epics`        | `project`, `closed?`, `limit?`                                                         | Epics with status and how many of their stories are done                    |
| `get_item`          | `project`, `ref`                                                                       | One story, issue or epic in full: description, custom fields, last comments |

How the tools are meant to be used by a model:

- **Names in, names out.** `project` is the slug from `list_projects`; statuses, severities, priorities and sprints are given by name (case does not matter); items are addressed by the `#123` reference number. Internal ids never appear.
- **`sprint`** takes a sprint name, `current` (the open sprint whose dates include today) or `backlog` (stories in no sprint).
- **`closed`** filters by whether the status counts as closed in the project, so "what is left" does not depend on status names.
- **`get_item` needs no type.** Taiga numbers stories, issues and epics of a project from one sequence, so the number says which kind it is.
- **Short answers.** Lists return 30 items unless `limit` says otherwise (at most 100), and say how many more exist. Long descriptions and comments are cut, with a note.
- **Errors say what to do next**, for example: `Project "Acme Billing" has no user story status "Doing". It has: New, In progress, Done.`

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

## Development

```bash
pnpm check   # types, lint, formatting, tests, build
pnpm test    # tests only; Taiga is faked, no network or account needed
```

- `src/taiga/http.ts` is the only code that talks to Taiga: sign-in, token renewal, paging, error messages.
- `src/taiga/client.ts` asks Taiga what the tools need: it turns slugs and names into ids, and trims the answers.
- `src/tools/` holds one file per tool: its name, the description and arguments the model reads, and how the answer is worded.
- `src/server.ts` registers the tools; `src/index.ts` connects the server to stdio.
- `test/acme.ts` is the invented project the tests run against.

The server speaks MCP on stdout, so nothing else may be printed there. Diagnostics go to stderr.

## A note on data

What a tool returns is sent to the AI model you connect. Before pointing the server at a company Taiga, make sure that is acceptable where you work.
