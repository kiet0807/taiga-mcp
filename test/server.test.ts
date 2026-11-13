import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { TaigaClient } from '../src/taiga/client.js';
import { acme, TODAY } from './acme.js';
import { BASE, fakeTaiga, json, paged, USER, type Call } from './fake-taiga.js';

/** An MCP client talking to the real server in memory, with Taiga faked underneath. */
async function connect(fetchImpl: typeof fetch) {
  const server = createServer(new TaigaClient({ baseUrl: BASE, token: 't' }, fetchImpl, () => TODAY));
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

const connectTo = (handler: (call: Call) => Response) => connect(fakeTaiga(handler).fetch);

type Result = Awaited<ReturnType<Client['callTool']>>;
const textOf = (result: Result) =>
  (result.content as { type: string; text: string }[]).map((part) => part.text).join('\n');

/** Call a tool on the Acme project and return its text; a tool error fails the test. */
async function ask(
  name: string,
  args: Record<string, unknown> = {},
  override?: (call: Call) => Response | undefined,
) {
  const client = await connect(acme(override).fetch);
  const result = await client.callTool({ name, arguments: { project: 'acme-billing', ...args } });
  expect(result.isError, textOf(result)).toBeFalsy();
  return textOf(result);
}

describe('the MCP server', () => {
  it('declares every tool read-only, with a description', async () => {
    const client = await connectTo(() => json([]));
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'list_projects',
      'get_project',
      'list_sprints',
      'get_sprint',
      'list_user_stories',
      'list_tasks',
      'list_issues',
      'list_epics',
      'get_item',
      'get_attachment',
      'list_activity',
      'search',
      'list_wiki_pages',
      'get_wiki_page',
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(40);
    }
  });

  it('describes every argument, and requires only what names the thing to read', async () => {
    const client = await connectTo(() => json([]));
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
      for (const [name, schema] of Object.entries(properties)) {
        expect(schema.description, `${tool.name}.${name}`).toBeTruthy();
      }
      const required: Record<string, string[]> = {
        list_projects: [],
        get_item: ['project', 'ref'],
        search: ['project', 'words'],
        get_wiki_page: ['project', 'page'],
        get_attachment: ['project', 'ref', 'file'],
      };
      expect(tool.inputSchema.required ?? [], tool.name).toEqual(required[tool.name] ?? ['project']);
    }
  });

  it('a Taiga failure comes back as a tool error the model can read, not as a crash', async () => {
    const client = await connectTo(() => json({}, 403));
    const result = await client.callTool({ name: 'list_projects' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/may not read/);
  });

  it('a wrong name comes back as a tool error that says what to do', async () => {
    const client = await connect(acme().fetch);
    const result = await client.callTool({ name: 'list_issues', arguments: { project: 'billing' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No project with slug "billing".*list_projects/);
  });

  it('refuses an argument outside its range before asking Taiga', async () => {
    const taiga = acme();
    const client = await connect(taiga.fetch);
    const result = await client
      .callTool({ name: 'list_issues', arguments: { project: 'acme-billing', limit: 500 } })
      .catch((error: unknown) => ({ isError: true, content: [{ type: 'text', text: String(error) }] }));
    expect(result.isError).toBe(true);
    expect(taiga.calls).toHaveLength(0);
  });
});

describe('list_projects', () => {
  it('answers with names and slugs', async () => {
    const client = await connectTo((call) =>
      call.path === '/users/me'
        ? json(USER)
        : json([
            { id: 1, name: 'Billing', slug: 'billing', is_private: true },
            { id: 2, name: 'Docs', slug: 'docs', is_private: false },
          ]),
    );
    const result = await client.callTool({ name: 'list_projects' });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe('2 projects:\n- Billing (slug: billing)\n- Docs (slug: docs) · public');
  });

  it('says so when there are none', async () => {
    const client = await connectTo((call) => (call.path === '/users/me' ? json(USER) : json([])));
    expect(textOf(await client.callTool({ name: 'list_projects' }))).toMatch(/not a member of any/);
  });
});

describe('list_sprints', () => {
  it('lists open sprints with dates, progress, and the one running today', async () => {
    expect(await ask('list_sprints')).toBe(
      [
        'Acme Billing · open sprints: 2 sprints.',
        // Sprint 8 has no points, so the points part is left out.
        '- Sprint 8 · 2026-03-16 to 2026-03-27 · no stories',
        '- Sprint 7 · 2026-03-02 to 2026-03-13 · running today · 1 of 3 stories done · 5 of 13 points done',
      ].join('\n'),
    );
  });

  it('lists closed sprints on request', async () => {
    expect(await ask('list_sprints', { closed: true })).toBe(
      'Acme Billing · closed sprints: 1 sprint.\n' +
        '- Sprint 6 · 2026-02-16 to 2026-02-27 · 1 of 1 story done · 21 of 21 points done',
    );
  });
});

describe('list_user_stories', () => {
  it('lists stories one per line, with the sprint of each', async () => {
    expect(await ask('list_user_stories')).toBe(
      [
        'Acme Billing: 3 user stories.',
        '- #41 Export invoices as PDF · In progress · Linh Tran · 5 pts · Sprint 7',
        '- #42 Retry failed card payments · New · unassigned · no points · Sprint 7 · BLOCKED',
        '- #38 Monthly statement email · Done (closed) · Kiet · 3 pts · backlog',
      ].join('\n'),
    );
  });

  it('repeats the filters in the heading and says how to get the items that did not fit', async () => {
    const answer = await ask('list_user_stories', {
      sprint: 'current',
      closed: false,
      assigned_to_me: true,
      limit: 1,
    });
    expect(answer).toBe(
      [
        'Acme Billing · current sprint "Sprint 7" · open only · assigned to me: 3 user stories, 1 to 1 shown (page 1 of 3).',
        '- #41 Export invoices as PDF · In progress · Linh Tran · 5 pts',
        '',
        '2 more after these. For the next ones call again with `page`: 2 and the same `limit` and filters, or narrow the filters.',
      ].join('\n'),
    );
  });

  it('answers a later page with where it is in the list, and says when it is the last', async () => {
    expect(await ask('list_user_stories', { limit: 2, page: 2 })).toBe(
      [
        'Acme Billing: 3 user stories, 3 to 3 shown (page 2 of 2).',
        '- #38 Monthly statement email · Done (closed) · Kiet · 3 pts · backlog',
        '',
        'This is the last page.',
      ].join('\n'),
    );
  });

  it('a page past the end is a tool error that says where to start', async () => {
    const client = await connect(acme().fetch);
    const result = await client.callTool({
      name: 'list_user_stories',
      arguments: { project: 'acme-billing', limit: 2, page: 9 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/no page 9 at 2 items a page/);
  });

  it('names the epic, the person and the words in the heading', async () => {
    const answer = await ask('list_user_stories', { epic: 12, assigned_to: 'tran', search: ' card ' });
    expect(answer.split('\n')[0]).toBe(
      'Acme Billing · epic #12 · assigned to Linh Tran · matching "card": 3 user stories.',
    );
  });

  it('says so when nothing matches', async () => {
    const answer = await ask('list_user_stories', { status: 'Done' }, (call) =>
      call.path === '/userstories' ? paged([], call) : undefined,
    );
    expect(answer).toBe('Acme Billing · status "Done": no user stories found.');
  });
});

describe('list_tasks', () => {
  it('lists tasks one per line, with the story and sprint of each', async () => {
    expect(await ask('list_tasks')).toBe(
      [
        'Acme Billing: 3 tasks.',
        '- #70 Ask the bank for a sandbox key · In progress · Linh Tran · story #42 · Sprint 7',
        '- #71 Schedule the three retries · New · unassigned · story #42 · Sprint 7 · BLOCKED',
        '- #72 Rotate the API key · Closed (closed) · Kiet · no story',
      ].join('\n'),
    );
  });

  it('leaves the story and the sprint out of the lines when the heading names them', async () => {
    const answer = await ask('list_tasks', { story: 42, sprint: 'Sprint 7', assigned_to: 'unassigned' });
    expect(answer.split('\n').slice(0, 2)).toEqual([
      'Acme Billing · story #42 · sprint "Sprint 7" · assigned to nobody: 2 tasks.',
      '- #70 Ask the bank for a sandbox key · In progress · Linh Tran',
    ]);
  });
});

describe('counting', () => {
  it('names every filter in the heading, and shows when each item was finished', async () => {
    const answer = await ask('list_user_stories', {
      assigned_to_me: true,
      tag: 'backend',
      created_from: '2026-01-01',
      finished_from: '2026-02-01',
      finished_to: '2026-02-28',
      limit: 100,
    });
    const lines = answer.split('\n');
    expect(lines[0]).toBe(
      'Acme Billing · assigned to me · tag "backend" · created from 2026-01-01 · finished 2026-02-01 to 2026-02-28: 3 user stories.',
    );
    expect(lines[3]).toBe(
      '- #38 Monthly statement email · Done (closed) · Kiet · 3 pts · backlog · finished 2026-02-20',
    );
  });

  it('counts the epics of one person', async () => {
    const answer = await ask('list_epics', { assigned_to: 'Linh Tran', closed: true, status: 'Done' });
    expect(answer.split('\n')[0]).toBe(
      'Acme Billing · status "Done" · closed only · assigned to Linh Tran: 2 epics.',
    );
  });
});

describe('get_project', () => {
  it('describes the project, its people and the names its items use', async () => {
    expect(await ask('get_project')).toBe(
      [
        'Project: Acme Billing (slug: acme-billing) · private',
        'Description: Invoices and card payments for Acme.',
        'Switched on: backlog, issues, epics, wiki',
        'Sprints: 2 open, 1 closed',
        '',
        'Members (4):',
        '- Kiet (kiet) · Back',
        '- Linh Tran (linh.tran) · Front',
        '- Võ Thị Linh (vtlinh) · QA',
        '- Đỗ Minh Đức (duc) · Product Owner',
        '',
        'User story statuses: New, In progress, Done (closed)',
        'Task statuses: New, In progress, Closed (closed)',
        'Issue statuses: New, Needs Info, Closed (closed)',
        'Epic statuses: In progress, Done (closed)',
        'Issue types: Bug, Question',
        'Severities: Minor, Critical',
        'Priorities: Low, High',
        'Tags (2 tags): backend, payments',
        'Epic custom fields: Start date, End date, Budget',
      ].join('\n'),
    );
  });
});

describe('the wiki tools', () => {
  it('lists the pages', async () => {
    expect(await ask('list_wiki_pages')).toBe(
      [
        'Acme Billing: 2 wiki pages.',
        '- release-steps · "How we release" · changed 2026-03-01 · 4 edits · 60 characters',
        '- home · changed 2026-01-05 · 1 edit · 8 characters',
      ].join('\n'),
    );
  });

  it('reads one page', async () => {
    expect(await ask('get_wiki_page', { page: 'How we release' })).toBe(
      [
        'Wiki page "How we release" (slug: release-steps) of Acme Billing',
        '',
        'Last changed: 2026-03-01 by Linh Tran',
        'Created: 2026-01-10',
        'Edits: 4',
        '',
        '# Release',
        '',
        '1. Freeze the branch.',
        '2. Run the payment checks.',
      ].join('\n'),
    );
  });
});

describe('search', () => {
  it('looks in every kind of item at once, and says where to get the rest', async () => {
    expect(await ask('search', { words: 'card', limit: 2 })).toBe(
      [
        'Acme Billing · matching "card": 3 user stories, 3 tasks, 2 issues, 2 epics, 1 wiki page.',
        '',
        'User stories (2 of 3 shown; for all of them call list_user_stories with `search`):',
        '- #41 Export invoices as PDF · In progress · Linh Tran',
        '- #42 Retry failed card payments · New · unassigned',
        '',
        'Tasks (2 of 3 shown; for all of them call list_tasks with `search`):',
        '- #70 Ask the bank for a sandbox key · In progress · Linh Tran',
        '- #71 Schedule the three retries · New · unassigned',
        '',
        'Issues (2):',
        '- #57 Total is wrong when a discount applies · New · Kiet',
        '- #55 Which currencies are supported? · Closed (closed) · unassigned',
        '',
        'Epics (2):',
        '- #12 Card payments · In progress · Linh Tran',
        '- #9 Invoices · Done (closed) · unassigned',
        '',
        'Wiki pages (1; read one with get_wiki_page):',
        '- release-steps · "How we release"',
      ].join('\n'),
    );
  });

  it('still answers when one kind cannot be searched', async () => {
    const answer = await ask('search', { words: 'card' }, (call) =>
      call.path === '/search' ? json({}, 500) : call.path === '/epics' ? paged([], call) : undefined,
    );
    expect(answer).toContain('0 epics, wiki pages not searched.');
    expect(answer).toMatch(/Wiki pages: could not be searched \(Taiga answered 500/);
    expect(answer).not.toContain('Epics');
  });

  it('a wrong project is one error, not five', async () => {
    const client = await connect(acme().fetch);
    const result = await client.callTool({
      name: 'search',
      arguments: { project: 'billing', words: 'card' },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^No project with slug "billing"/);
  });
});

describe('list_issues', () => {
  it('lists issues with type, severity and priority by name', async () => {
    expect(await ask('list_issues', { severity: 'critical' })).toBe(
      [
        'Acme Billing · severity "critical": 2 issues.',
        '- #57 [Bug] Total is wrong when a discount applies · New · severity Critical · priority High · Kiet',
        '- #55 [Question] Which currencies are supported? · Closed (closed) · severity Minor · priority Low · unassigned',
      ].join('\n'),
    );
  });
});

describe('list_epics', () => {
  it('lists epics with the progress of their stories', async () => {
    expect(await ask('list_epics')).toBe(
      [
        'Acme Billing: 2 epics.',
        '- #12 Card payments · In progress · Linh Tran · 8 stories, 31% done',
        '- #9 Invoices · Done (closed) · unassigned · no stories',
      ].join('\n'),
    );
  });
});

describe('get_item', () => {
  it('reads a story in full', async () => {
    expect(await ask('get_item', { ref: 42 })).toBe(
      [
        'User story #42: Retry failed card payments',
        '',
        'Project: Acme Billing',
        'Status: New',
        'Assigned to: unassigned',
        'Due: 2026-03-13',
        'Sprint: Sprint 7',
        'Epics: #12 Card payments',
        // One watcher has left the project since: Taiga still counts them, without a name.
        'Watchers: Linh Tran, a former member',
        'Votes: 2',
        'Blocked: Waiting for the bank sandbox',
        'Tags: payments, backend',
        'Created: 2026-03-01 by Linh Tran',
        'Last changed: 2026-03-09',
        '',
        'Description:',
        'When a card payment fails, retry it **three times** over 24 hours.',
        '',
        'Tasks (2, 2 still open):',
        '- #70 Ask the bank for a sandbox key · In progress · Linh Tran',
        '- #71 Schedule the three retries · New · unassigned · BLOCKED',
        '',
        'Attachments (1; read one with get_attachment and its number):',
        '1. bank-reply.pdf · 84 KB · What the bank answered · https://taiga.example/files/bank-reply.pdf',
        '',
        'Comments (2, newest first):',
        '- 2026-03-09 Linh Tran: Sandbox access is promised for Thursday.',
        '- 2026-03-05 Kiet: Blocked: the bank sandbox rejects our key.',
      ].join('\n'),
    );
  });

  it('reads fewer comments and the history on request', async () => {
    const answer = await ask('get_item', { ref: 42, comments: 1, changes: true });
    expect(answer.split('\n\n').slice(-2)).toEqual([
      'Comments (latest 1 of 2, newest first):\n- 2026-03-09 Linh Tran: Sandbox access is promised for Thursday.',
      [
        'Changes (2, newest first):',
        '- 2026-03-06 Linh Tran: is blocked: false → true; blocked note edited',
        '- 2026-03-02 Kiet: sprint: none → Sprint 7; assigned to: Linh Tran → none; points (Back): ? → 5',
      ].join('\n'),
    ]);
    expect(await ask('get_item', { ref: 42, comments: 0 })).not.toContain('Comments');
  });

  it('reads an epic with its custom fields', async () => {
    expect(await ask('get_item', { ref: 12 })).toBe(
      [
        'Epic #12: Card payments',
        '',
        'Project: Acme Billing',
        'Status: In progress',
        'Assigned to: Linh Tran',
        'Stories: 8 stories, 31% done',
        'Created: 2026-01-05 by Kiet',
        'Last changed: 2026-03-08',
        '',
        'Description:',
        '(empty)',
        '',
        'Custom fields:',
        '- Start date: 2026-01-05',
        '- End date: 2026-02-27',
        '',
        'Comments: none.',
      ].join('\n'),
    );
  });

  it('reads a task with its story', async () => {
    expect(await ask('get_item', { ref: 70 })).toBe(
      [
        'Task #70: Ask the bank for a sandbox key',
        '',
        'Project: Acme Billing',
        'Status: In progress',
        'Assigned to: Linh Tran',
        'User story: #42 Retry failed card payments',
        'Sprint: Sprint 7',
        'Created: 2026-03-03 by Kiet',
        'Last changed: 2026-03-09',
        '',
        'Description:',
        'The key we have is rejected. Ask for one the sandbox accepts.',
        '',
        'Comments: none.',
      ].join('\n'),
    );
  });

  it('cuts a very long description and says how much is missing', async () => {
    const answer = await ask('get_item', { ref: 57 }, (call) =>
      call.path === '/issues/2001'
        ? json({ id: 2001, ref: 57, subject: 'Long', description: 'x'.repeat(4100) })
        : undefined,
    );
    expect(answer).toContain(`${'x'.repeat(4000)}… [100 more characters not shown]`);
    expect(answer).not.toContain('x'.repeat(4001));
  });
});
