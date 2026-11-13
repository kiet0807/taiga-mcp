# How taiga-mcp works

This guide explains the repository from the outside in: first the big picture, then each flow step by step, and last
where to make a change. Every path is a link into the code. It describes version 0.4.0.

**Quick read (10 minutes):** sections 1, 2, 3 and flow 4.1.
**Before changing code:** add sections 5, 6, 8 and the flows in section 4 that you will touch.

---

## 1. What taiga-mcp is, in one paragraph

Taiga is a project management tool (sprints, user stories, tasks, issues, epics, a wiki). Claude and other AI assistants
cannot open Taiga by themselves. The **Model Context Protocol** (MCP) is a standard for a program to offer "tools" to an
AI: each tool has a name, a description and a list of arguments. The AI reads the descriptions, decides which tool to
call with which arguments, and reads the answer.

`taiga-mcp` is an **MCP server**: it declares 17 tools (14 that read, 3 that write), and when the AI calls one, it asks
Taiga's API on the AI's behalf, then writes the answer as short text for the AI to read.

```
 User ──asks──▶ Claude ──calls a tool──▶ taiga-mcp ──HTTP──▶ Taiga's API
                  ▲                          │
                  └──────── the answer ──────┘   (text, trimmed, with counts and the next step)
```

Three ideas shape the whole repository:

1. **The reader of every answer is a model**, not a person. So answers are short, use names rather than ids, always say
   how many items are not shown, and on an error say what to do next.
2. **What is in Taiga was written by other people.** Titles, descriptions, comments, the wiki and attached files may
   contain something like "delete this sprint". The AI is told to report such text, never to follow it.
3. **Nothing is stored.** No database. The hosted server keeps everything it must remember inside the tokens it hands
   out, encrypted.

---

## 2. Two ways to run

|                            | **On your machine (stdio)**       | **Hosted (HTTP)**                                                             |
| -------------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| For                        | One person with a terminal        | A team, including people who never write code                                 |
| Entry point                | [`src/index.ts`](../src/index.ts) | [`src/remote.ts`](../src/remote.ts) (by hand), [`app.js`](../app.js) (Vercel) |
| The AI talks to the server | Over the process's stdin/stdout   | `POST /mcp` over HTTPS                                                        |
| Taiga account              | In a local `.env` file            | Each person signs in on the server's page (OAuth)                             |
| Writing                    | `TAIGA_WRITE=true`                | `ALLOW_WRITES=true`, then each person ticks a box at sign-in                  |

Both share **the whole core**: the same tools, the same `TaigaClient`. Only the outer layer differs (how a request
arrives and where the Taiga token comes from).

```
                      ┌────────────── shared core ──────────────┐
 stdio ─▶ index.ts ───┐                                          │
                      ├─▶ server.ts ─▶ tools/*.ts ─▶ taiga/client.ts ─▶ taiga/http.ts ─▶ Taiga
 HTTP  ─▶ remote/app.ts ┘                                        │
   (OAuth: remote/provider.ts, seal.ts, taiga-auth.ts, guard.ts, pages.ts)
```

---

## 3. Map of the repository

| Path                                                      | Role                                                                                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/server.ts`](../src/server.ts)                       | Creates the MCP server, writes the **general instructions** for the AI, registers the tools. The writing tools are registered only on a connection that may write |
| [`src/tools/`](../src/tools/)                             | **One file per tool**: name, description, arguments (zod) and how the answer is worded. This is the part the AI "sees"                                            |
| [`src/tools/shared.ts`](../src/tools/shared.ts)           | Shared arguments (`project`, `limit`, `page`, filters…), the `READ_ONLY` / `ADDS` / `OVERWRITES` annotations, the `ONLY_WHEN_ASKED` sentence                      |
| [`src/taiga/client.ts`](../src/taiga/client.ts)           | **The brain**: turns slugs and names into ids, asks Taiga for what a tool needs, trims the answers, checks a change before sending it                             |
| [`src/taiga/http.ts`](../src/taiga/http.ts)               | **The only code that talks to Taiga**: sign-in, token renewal, paging, file downloads, errors in words, the lock on writing                                       |
| [`src/taiga/types.ts`](../src/taiga/types.ts)             | Data shapes: `Raw*` is what Taiga returns, the rest is the trimmed form                                                                                           |
| [`src/taiga/files.ts`](../src/taiga/files.ts)             | Reads attachments: Excel, Word, PowerPoint (zip archives of XML), PDF, CSV, text, images                                                                          |
| [`src/tools/file-view.ts`](../src/tools/file-view.ts)     | Chooses which part of a file fits in one answer (at most 20,000 characters)                                                                                       |
| [`src/format.ts`](../src/format.ts)                       | Wording: lists with a count in the heading, cutting long text, comparing names without accents                                                                    |
| [`src/config.ts`](../src/config.ts)                       | Environment variables of the local server                                                                                                                         |
| [`src/remote/app.ts`](../src/remote/app.ts)               | The hosted server: the routes `/authorize`, `/login`, `/token`, `/mcp` and the front page                                                                         |
| [`src/remote/provider.ts`](../src/remote/provider.ts)     | The OAuth steps, the `read` and `write` scopes                                                                                                                    |
| [`src/remote/seal.ts`](../src/remote/seal.ts)             | Encrypts everything the server hands out (AES-256-GCM)                                                                                                            |
| [`src/remote/taiga-auth.ts`](../src/remote/taiga-auth.ts) | Sign-in and renewal at Taiga, for the hosted server                                                                                                               |
| [`src/remote/guard.ts`](../src/remote/guard.ts)           | Refuses Taiga addresses that lead into a private network (when people type the address)                                                                           |
| [`src/remote/pages.ts`](../src/remote/pages.ts)           | The front page and the sign-in page, in English and Vietnamese. The only script is the copy buttons' on the front page                                            |
| [`src/remote/config.ts`](../src/remote/config.ts)         | Environment variables of the hosted server                                                                                                                        |
| [`test/`](../test/)                                       | Tests against a **fake Taiga** ([`fake-taiga.ts`](../test/fake-taiga.ts)) and an invented project, "Acme Billing" ([`acme.ts`](../test/acme.ts))                  |
| [`public/`](../public/)                                   | Icons, the link-preview image (`og.png`, made from [`design/og.html`](../design/og.html)), `robots.txt`                                                           |

---

## 4. The flows

### 4.1. A question from Claude to Taiga and back

Example: _"Which tasks are left on story 42?"_

```
Claude                server.ts / tools           taiga/client.ts                 taiga/http.ts            Taiga
  │ get_item {project, ref:42}                          │                               │                      │
  ├────────────────────────▶│ zod checks arguments      │                               │                      │
  │                         ├──────────────────────────▶│ #project(slug) (kept 60 s)    │                      │
  │                         │                           ├──────────────────────────────▶│ GET /projects/by_slug│
  │                         │                           │ #resolve(42): what is it?     ├─────────────────────▶│
  │                         │                           │                               │ GET /resolver        │
  │                         │                           │ read in parallel: the item,   │                      │
  │                         │                           │ comments, tasks, files…       │ GET … (several)      │
  │                         │◀──────────────────────────┤ ItemDetail (trimmed)          │                      │
  │◀────────────────────────┤ describe(): into words    │                               │                      │
  │  "User story #42: … Tasks (2, 1 still open): …"     │                               │                      │
```

Step by step, with the files:

1. **Claude picks the tool.** It reads the description in [`src/tools/get-item.ts`](../src/tools/get-item.ts) and sees
   that this tool reads one item by its number.
2. **Arguments are checked.** The MCP library uses the zod schema to refuse bad arguments _before_ Taiga is asked (for
   example `limit: 500`).
3. **The project is looked up.** `#project()` in [`client.ts`](../src/taiga/client.ts) calls `/projects/by_slug` once,
   which brings the statuses, members, sprints, issue types…, and keeps it for 60 seconds. That is what turns
   "In progress" into an id later without another request.
4. **What is #42?** Taiga numbers stories, tasks, issues and epics of a project from one sequence, so `#resolve()` asks
   `/resolver` whether it is a story or a task. That is why the AI need not know the kind.
5. **Read in parallel** whatever is needed (`Promise.all`): the item, its custom fields, comments, history, a story's
   tasks, attachments.
6. **HTTP** through [`http.ts`](../src/taiga/http.ts): the token is attached; on a 401 the token is renewed once and the
   request retried; every error is worded with what to do (404 → "no such project, call list_projects for the slugs").
7. **The data is trimmed** into an `ItemDetail` ([`types.ts`](../src/taiga/types.ts)): ids disappear, names remain.
8. **The answer is written** in the tool's `describe()`: long descriptions are cut with a note on how much is missing,
   newest comments first.
9. **Errors never crash the server.** [`format.ts`](../src/format.ts) wraps every tool in `answer()`: an error comes
   back as text flagged `isError`, for the AI to read and try something else.

The list tools (`list_user_stories`, `list_tasks`…) follow the same path, plus two things:

- **Filters become Taiga's query** in `#commonFilters()`: a status name becomes an id, a person's name becomes an id
  (missing accents or part of a name are fine), days become `created_date__gte`…
- **Paging:** Taiga gives the total in the `x-pagination-count` header. The first line of every list answer carries it,
  so "how many" takes one call.

### 4.2. Signing in on the hosted server (OAuth)

Taiga **has no OAuth**, so the server puts its own OAuth 2.1 layer (PKCE, dynamic client registration) in front of
Taiga's username and password. The key point: **everything to remember travels inside the values the server hands
out**, encrypted.

```
 AI app (Claude)                   taiga-mcp (Vercel)                          Taiga
   │ POST /mcp (no token)      ─▶  401 + "sign in here"
   │ reads /.well-known/…      ─▶  the /authorize, /token and /register addresses
   │ POST /register            ─▶  client_id = seal(client details)          (nothing kept on the server)
   │ opens /authorize          ─▶  sign-in page; hidden field request = seal(…, 15 minutes)
   │      the person types a username and password (and ticks the box that allows changes)
   │      POST /login          ─▶  ───────────── POST /auth (username, password) ─▶ Taiga token
   │                               code = seal({Taiga token, address, write}, 2 minutes)
   │ ◀── redirect back to the app with the code
   │ POST /token (code + PKCE) ─▶  access  = seal({Taiga token, address, write}, ~24 hours)
   │                               refresh = seal({Taiga refresh, address, write}, ~8 days)
   │ POST /mcp, Bearer access  ─▶  unseal → a NEW TaigaClient for this request alone ─▶ Taiga
```

- **`seal()`** ([`seal.ts`](../src/remote/seal.ts)): AES-256-GCM with a key derived from `MCP_SECRET`. Each value is
  bound to one purpose (`client`, `login`, `code`, `access`, `refresh`): a value sealed for one purpose does not open
  for another, and changing one byte breaks it. Changing `MCP_SECRET` signs everyone out.
- **The password** passes through the server once, straight to Taiga, and is never stored or logged.
- **A new server for every `/mcp` request** ([`app.ts`](../src/remote/app.ts)): no cache is shared between two people.
- **Renewal:** the app sends its refresh token → the server renews at Taiga → a new pair. The choice to allow changes
  carries over.
- **Against password guessing:** at most 10 sign-ins per 15 minutes per address.
- **"Any Taiga" mode** (`ANY_TAIGA=true`): people type the address of their Taiga. [`guard.ts`](../src/remote/guard.ts)
  refuses any address that resolves to a private network (127.x, 10.x, 169.254.x…), including after a redirect, so
  nobody can use the server to probe the network it runs in.
- **Limits of storing nothing:** one session cannot be revoked before its token expires; a code is kept from being used
  twice only within one running process (PKCE covers the rest).

### 4.3. Writing: create, change, comment (0.4.0)

**Three locks**, all of which must be open:

```
 1. Does the server allow it?   TAIGA_WRITE=true (local)  /  ALLOW_WRITES=true (hosted)
 2. Does the person allow it?   (hosted) a box ticked at sign-in → the token carries the scope "read write"
 3. Does the HTTP layer allow it? http.ts: write() refuses POST and PATCH on a read-only connection, whoever calls it
                                (and there is no function that sends a DELETE)
```

Without lock 1 or 2 the three writing tools are **not registered**, so the AI does not see them. It is told how the
user can allow changes, if they ask for one.

**The `update_item` flow** (for example: "move task 70 to Done and give it to me"):

```
 get_item #70 ──▶ "… Version: 7 (pass it to update_item)"
 update_item {ref:70, version:7, status:"Done", assigned_to:"me"}
   ├─ read #70 again right now (to show before and after)
   ├─ names into ids: "Done" → 73, "me" → your id     (a wrong name → error, NOTHING is sent)
   ├─ drop fields that would not change; nothing left → "Nothing to change", nothing is sent
   ├─ version 9 while the item is at 7 → refused at once (no such version)
   └─ PATCH /tasks/{id} {status, assigned_to, version:7}
          Taiga: older version + someone changed the SAME field since → 400 → "Not changed: someone changed…"
                 older version + a DIFFERENT field → Taiga merges and accepts
   ◀── "- Status: In progress → Done / - Assigned to: Linh → Kiet / Open in Taiga: …"
```

The details are in `updateItem()` in [`client.ts`](../src/taiga/client.ts) and the tool
[`update-item.ts`](../src/tools/update-item.ts).

**`create_item`:** every name (status, person, sprint, parent story, epic) is checked _before_ the `POST`; a task needs
a story or a sprint (otherwise it appears on no board); a task created on a story joins the story's sprint. If a story
is created but adding it to its epic fails, the answer says "it was created, do not create it again".

**`add_comment`:** a `PATCH` with a `comment` field and the current version (a comment never conflicts).

**A connection lost while writing:** the answer says "the change may have been made, check before trying again", so the
AI does not create a duplicate.

### 4.4. Reading attachments

```
 get_item #42 ──▶ "Attachments: 1. bank-reply.pdf · 84 KB …"
 get_attachment {ref:42, file:1}
   ├─ download (no Taiga token sent; at most 10 MB, images at most 3 MB)
   ├─ files.ts: xlsx/docx/pptx → unzip, read the XML; PDF → pdf.js (unpdf); CSV, text → by line; images → as they are
   ├─ kept for 10 minutes by the file's sha1 (64 MB at most), so the next part needs no new download
   └─ file-view.ts: small → whole; large → an OVERVIEW first (which sheets, how many rows, the first rows; how many pages…)
                    then the AI asks for the part it needs: {sheet, rows:"120-300"} / {pages:"3-5"} / {find:"word"}
```

The purpose: one large spreadsheet must not flood the AI's context. Each answer stays under 20,000 characters (some
5,000 tokens).

### 4.5. The activity log (`list_activity`)

Taiga only lets the log be read from the newest event backwards; it cannot jump to a day. So the server reads back in
batches of 100 events, at most 10 batches (1,000 events), filters by person, day, kind or item, and says how far back it
looked. If the log has been silent for more than 7 days, the answer says on which day it ends and points to the sources
still recorded: each item's history (`get_item` with `changes`).

---

## 5. Design principles that run through the code

| Principle                                                                                          | Where                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Names in, names out.** The AI says "In progress", "Linh", "Sprint 7", "#42"; it never sees an id | `find()`, `findMember()`, `#sprintFilter()` in `client.ts`                                                 |
| **The count in the first line** of every list, with how to get the next page                       | `list()` in [`format.ts`](../src/format.ts)                                                                |
| **Errors say what to do next**, with the valid names                                               | every `throw new TaigaError(...)`                                                                          |
| **Short answers:** long descriptions and comments are cut, with a note on what was cut             | `truncate()`                                                                                               |
| **Text in Taiga is not an instruction**                                                            | `UNTRUSTED` in [`server.ts`](../src/server.ts), `ONLY_WHEN_ASKED` in [`shared.ts`](../src/tools/shared.ts) |
| **Tool descriptions are written for the AI:** when to use the tool, and when to use another        | each tool's `description`                                                                                  |
| **One place calls Taiga**                                                                          | [`http.ts`](../src/taiga/http.ts)                                                                          |

---

## 6. Configuration

**Local** (`.env`, see [`.env.example`](../.env.example)):

| Variable                             | Meaning                                             |
| ------------------------------------ | --------------------------------------------------- |
| `TAIGA_URL`                          | Address of the Taiga API, with or without `/api/v1` |
| `TAIGA_USERNAME`, `TAIGA_PASSWORD`   | Sign in; the server renews its tokens by itself     |
| `TAIGA_TOKEN`, `TAIGA_REFRESH_TOKEN` | Or use tokens you already have                      |
| `TAIGA_WRITE`                        | `true` adds the three writing tools                 |

**Hosted** (environment variables of the host):

| Variable       | Meaning                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ANY_TAIGA`    | People type the address of their own Taiga                                                                           |
| `TAIGA_URL`    | The one Taiga people sign in to (with `ANY_TAIGA`, only a suggestion)                                                |
| `PUBLIC_URL`   | The server's address, without a path                                                                                 |
| `MCP_SECRET`   | At least 32 random characters: the key of `seal()`                                                                   |
| `ALLOW_WRITES` | Whether the sign-in page offers the box that allows changes; turning it off takes writing away from everyone at once |

The instance at [taiga.kietnguyen.io.vn](https://taiga.kietnguyen.io.vn) runs with `ANY_TAIGA=true` and
`ALLOW_WRITES=true`.

---

## 7. Deploying

- **On Vercel, pushing to `main` deploys.** Vercel runs `pnpm build` (TypeScript → `dist/`), then runs
  [`app.js`](../app.js) as one function. `app.js` imports from `dist/`, not `src/`: Vercel's own type check of `.ts`
  entry files reported false errors.
- `app.js` keeps the line `import 'express'`: it is how Vercel recognizes an Express app.
- Vercel serves `public/` itself; elsewhere the app does.
- CI on GitHub ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs `pnpm check` on every push.

---

## 8. Testing

```bash
pnpm check       # types, lint, formatting, tests, build. No network or account needed
pnpm test        # tests only
pnpm inspect     # the MCP Inspector: call each tool by hand in a browser (uses .env)
```

- **Tests never call a real Taiga.** [`fake-taiga.ts`](../test/fake-taiga.ts) replaces `fetch` with a function that
  records every request and answers from the invented data in [`acme.ts`](../test/acme.ts). Tests check both _the
  request sent_ (the right filters?) and _the answer written_.
- [`server.test.ts`](../test/server.test.ts), [`reads.test.ts`](../test/reads.test.ts): the reading tools, through a real
  MCP client talking to the server in memory.
- [`writes.test.ts`](../test/writes.test.ts): writing, version conflicts, wrong names creating nothing, and a final check
  that no request was a DELETE.
- [`remote.test.ts`](../test/remote.test.ts): the hosted server on a real local port, through the whole OAuth flow, plus
  the pages (the copy buttons' script and the policy that allows only it).
- The author also keeps scripts that run against real Taiga instances (a public project on Taiga cloud, and the live
  server); they are not part of the repository.

---

## 9. Making a common change

**Add a reading tool**

1. Write the method that asks Taiga in [`client.ts`](../src/taiga/client.ts) (using `#project()`, `#http.get` or
   `#http.page`); add the trimmed result type to [`types.ts`](../src/taiga/types.ts).
2. Create `src/tools/<tool-name>.ts`: `registerXxx(server, taiga)` with a `title`, a `description` (written for the AI:
   when to use it, when to use another tool), an `inputSchema` (every argument with `.describe()`),
   `annotations: READ_ONLY`, and the function that words the answer.
3. Register it in [`server.ts`](../src/server.ts).
4. Add fake data to `acme.ts` if needed and write tests; update the list of tools in `server.test.ts` (that test checks
   the order and that every argument is described).
5. Update the tool table in the README, then run `pnpm check`.

**Let `update_item` change one more field**

1. Add it to `ItemChange` and to `updateItem()` in `client.ts` (use the `set(...)` helper to get a before → after line).
2. Add the argument in [`update-item.ts`](../src/tools/update-item.ts) and pass it down.
3. Test it in `writes.test.ts`: the right body is sent, the answer is right, and an unchanged value sends nothing.

**Change the words on the sign-in or front page:** edit `TEXT` at the top of [`pages.ts`](../src/remote/pages.ts), for
both `en` and `vi`. The link-preview image: edit [`design/og.html`](../design/og.html) and render it again with the
command at the top of that file. If you change the copy buttons' script, its hash in the policy follows by itself.

**Bump the version:** change `version` in [`package.json`](../package.json) **and** `SERVER_INFO` in
[`server.ts`](../src/server.ts).

---

## 10. Known limits

- People type their Taiga password on the server's page (Taiga has no OAuth). Use only a server you trust.
- One session cannot be revoked on its own; changing `MCP_SECRET` signs everyone out.
- On Vercel, the sign-in limit, the single use of a code and the file cache count per running instance.
- Attachments over 3 MB (images) or 10 MB (others) are not read; Vercel caps an answer at 4.5 MB.
- Writing does not cover story points, several assignees on one story, watchers, uploading files or creating epics.
  There will never be a delete.
- If a user lets Claude "always allow" the writing tools, instructions planted in Taiga text remain a risk: the
  instructions to the AI reduce it, they do not remove it.
