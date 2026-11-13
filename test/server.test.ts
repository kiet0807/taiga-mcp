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
      'list_sprints',
      'list_user_stories',
      'list_issues',
      'list_epics',
      'get_item',
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(40);
    }
  });

  it('describes every argument, and only `project` and `ref` are required', async () => {
    const client = await connectTo(() => json([]));
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
      for (const [name, schema] of Object.entries(properties)) {
        expect(schema.description, `${tool.name}.${name}`).toBeTruthy();
      }
      const required =
        tool.name === 'list_projects' ? [] : tool.name === 'get_item' ? ['project', 'ref'] : ['project'];
      expect(tool.inputSchema.required ?? [], tool.name).toEqual(required);
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

  it('repeats the filters in the heading and says how many items were left out', async () => {
    const answer = await ask('list_user_stories', {
      sprint: 'current',
      closed: false,
      assigned_to_me: true,
      limit: 1,
    });
    expect(answer).toBe(
      [
        'Acme Billing · current sprint "Sprint 7" · open only · assigned to me: 3 user stories, the first 1 shown.',
        '- #41 Export invoices as PDF · In progress · Linh Tran · 5 pts',
        '',
        '2 more not shown. Narrow the filters, or raise `limit` (at most 100).',
      ].join('\n'),
    );
  });

  it('says so when nothing matches', async () => {
    const answer = await ask('list_user_stories', { status: 'Done' }, (call) =>
      call.path === '/userstories' ? paged([], call) : undefined,
    );
    expect(answer).toBe('Acme Billing · status "Done": no user stories found.');
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
        'Sprint: Sprint 7',
        'Epics: #12 Card payments',
        'Blocked: Waiting for the bank sandbox',
        'Tags: payments, backend',
        'Created: 2026-03-01 by Linh Tran',
        'Last changed: 2026-03-09',
        '',
        'Description:',
        'When a card payment fails, retry it **three times** over 24 hours.',
        '',
        'Comments (2, newest first):',
        '- 2026-03-09 Linh Tran: Sandbox access is promised for Thursday.',
        '- 2026-03-05 Kiet: Blocked: the bank sandbox rejects our key.',
      ].join('\n'),
    );
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
