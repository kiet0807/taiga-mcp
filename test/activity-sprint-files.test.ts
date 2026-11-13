import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { forgetFiles, TaigaClient } from '../src/taiga/client.js';
import { acme, TODAY } from './acme.js';
import { xlsx } from './fake-files.js';
import { BASE, json, paged, type Call } from './fake-taiga.js';

interface Part {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

/** The server in memory with Taiga faked underneath, and a way to see what it asked Taiga. */
async function acmeServer(override?: (call: Call) => Response | undefined) {
  const taiga = acme(override);
  const server = createServer(new TaigaClient({ baseUrl: BASE, token: 't' }, taiga.fetch, () => TODAY));
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: { project: 'acme-billing', ...args } });
    const parts = result.content as Part[];
    return {
      parts,
      text: parts.map((part) => part.text ?? `[${part.type}]`).join('\n'),
      isError: result.isError === true,
    };
  };
  /** The text of an answer; a tool error fails the test. */
  const ask = async (name: string, args: Record<string, unknown> = {}) => {
    const answer = await call(name, args);
    expect(answer.isError, answer.text).toBe(false);
    return answer.text;
  };
  /** The text of a tool error; an answer fails the test. */
  const refusal = async (name: string, args: Record<string, unknown> = {}) => {
    const answer = await call(name, args);
    expect(answer.isError, answer.text).toBe(true);
    return answer.text;
  };
  return { call, ask, refusal, calls: taiga.calls };
}

// Files that were read stay in memory for a while, across clients: each test starts without them.
beforeEach(forgetFiles);

describe('list_activity', () => {
  it('tells what happened in the project, newest first, leaving out what says nothing', async () => {
    const { ask, calls } = await acmeServer();

    expect(await ask('list_activity')).toBe(
      [
        'Activity in Acme Billing (1 to 7, newest first; times in UTC):',
        '- 2026-03-10 09:00 · Linh Tran · changed task #70 Ask the bank for a sandbox key · status: New → In progress',
        '- 2026-03-09 10:00 · Linh Tran · commented on story #42 Retry failed card payments · "Sandbox access is promised for Thursday."',
        // 2026-03-08: a story was only moved on the board, which is not shown.
        '- 2026-03-07 08:00 · Kiet · created task #71 Schedule the three retries',
        '- 2026-03-06 08:00 · Kiet · linked story #42 Retry failed card payments to epic #12',
        // The rendered HTML of the page changed too; that would only repeat the line.
        '- 2026-03-05 08:00 · Linh Tran · changed wiki page release-steps · content edited',
        // 2026-03-04: Kiet created an issue in another project.
        '- 2026-03-01 08:00 · Kiet · created sprint "Sprint 8"',
        '- 2026-02-28 08:00 · Kiet · deleted issue #50 Duplicate of #57',
      ].join('\n'),
    );
    expect(calls.map((c) => c.path)).toEqual(['/projects/by_slug', '/timeline/project/10']);
  });

  it('reads the timeline of one person, and keeps to this project and the days asked for', async () => {
    const { ask, calls } = await acmeServer();

    expect(await ask('list_activity', { by_me: true, from: '2026-03-01' })).toBe(
      [
        'Activity in Acme Billing · by me · from 2026-03-01 (1 to 3, newest first; times in UTC):',
        '- 2026-03-07 08:00 · Kiet · created task #71 Schedule the three retries',
        '- 2026-03-06 08:00 · Kiet · linked story #42 Retry failed card payments to epic #12',
        '- 2026-03-01 08:00 · Kiet · created sprint "Sprint 8"',
      ].join('\n'),
    );
    expect(calls.at(-1)?.path).toBe('/timeline/user/7');

    expect(await ask('list_activity', { by: 'linh tran', to: '2026-03-08' })).toBe(
      [
        'Activity in Acme Billing · by Linh Tran · until 2026-03-08 (1 to 1, newest first; times in UTC):',
        '- 2026-03-05 08:00 · Linh Tran · changed wiki page release-steps · content edited',
      ].join('\n'),
    );
    expect(calls.at(-1)?.path).toBe('/timeline/user/8');
  });

  it('narrows to one item, one kind of thing, comments, or a span of days', async () => {
    const { ask } = await acmeServer();

    expect(await ask('list_activity', { ref: 42 })).toBe(
      [
        'Activity in Acme Billing · on #42 (1 to 2, newest first; times in UTC):',
        '- 2026-03-09 10:00 · Linh Tran · commented on story #42 Retry failed card payments · "Sandbox access is promised for Thursday."',
        '- 2026-03-06 08:00 · Kiet · linked story #42 Retry failed card payments to epic #12',
      ].join('\n'),
    );
    expect(await ask('list_activity', { kind: 'wiki' })).toBe(
      [
        'Activity in Acme Billing · on wiki (1 to 1, newest first; times in UTC):',
        '- 2026-03-05 08:00 · Linh Tran · changed wiki page release-steps · content edited',
      ].join('\n'),
    );
    expect(await ask('list_activity', { comments_only: true })).toBe(
      [
        'Activity in Acme Billing · comments only (1 to 1, newest first; times in UTC):',
        '- 2026-03-09 10:00 · Linh Tran · commented on story #42 Retry failed card payments · "Sandbox access is promised for Thursday."',
      ].join('\n'),
    );
    expect(await ask('list_activity', { from: '2026-03-06', to: '2026-03-07' })).toBe(
      [
        'Activity in Acme Billing · 2026-03-06 to 2026-03-07 (1 to 2, newest first; times in UTC):',
        '- 2026-03-07 08:00 · Kiet · created task #71 Schedule the three retries',
        '- 2026-03-06 08:00 · Kiet · linked story #42 Retry failed card payments to epic #12',
      ].join('\n'),
    );
  });

  it('hands out a long answer in parts and says how to get the next one', async () => {
    const { ask } = await acmeServer();

    expect(await ask('list_activity', { limit: 2 })).toBe(
      [
        'Activity in Acme Billing (1 to 2, newest first; times in UTC):',
        '- 2026-03-10 09:00 · Linh Tran · changed task #70 Ask the bank for a sandbox key · status: New → In progress',
        '- 2026-03-09 10:00 · Linh Tran · commented on story #42 Retry failed card payments · "Sandbox access is promised for Thursday."',
        '',
        'More after these: call again with `page`: 2 and the same `limit` and filters.',
      ].join('\n'),
    );
    const second = await ask('list_activity', { limit: 2, page: 2 });
    expect(second).toContain('(3 to 4, newest first; times in UTC)');
    expect(second).toContain('created task #71');
    expect(second).toContain('`page`: 3');
  });

  it('says so when nothing happened, and when the person is not one member', async () => {
    const { ask, refusal, calls } = await acmeServer();

    expect(await ask('list_activity', { from: '2027-01-01' })).toBe(
      'Activity in Acme Billing · from 2027-01-01: nothing found.',
    );

    const before = calls.length;
    expect(await refusal('list_activity', { by: 'linh' })).toBe(
      '"linh" matches several members of project "Acme Billing": Linh Tran (linh.tran), Võ Thị Linh (vtlinh). Pass the full name or the username.',
    );
    expect(await refusal('list_activity', { by: 'nobody' })).toContain(
      'has no member "nobody". Members: Kiet (kiet)',
    );
    // Neither question reached the timeline.
    expect(calls.slice(before)).toEqual([]);
  });
});

describe('get_sprint', () => {
  it('reads the running sprint: what is done, and the burndown up to today', async () => {
    const { ask, calls } = await acmeServer();

    expect(await ask('get_sprint')).toBe(
      [
        'Sprint "Sprint 7" of Acme Billing · 2026-03-02 to 2026-03-13 · open, running today',
        '',
        'Stories: 1 of 3 stories done (33%), counted by status',
        'Tasks: 1 of 3 tasks done (33%)',
        'Points: 5 of 13 points done (38%)',
        'Tasks flagged as iocaine (harder than planned): 1',
        '',
        'Burndown, points still open at the end of each day (ideal in brackets):',
        '- 2026-03-02: 13 (13)',
        '- 2026-03-03: 13 (11.6)',
        '- 2026-03-04: 13 (10.1)',
        '- 2026-03-05: 11 (8.7)',
        '- 2026-03-06: 11 (7.2)',
        '- 2026-03-09: 8 (5.8)',
        // Today is 2026-03-10: the three days after it have not happened and are not shown.
        '- 2026-03-10: 8 (4.3)',
        'On 2026-03-10: 8 points open, 3.7 above the ideal 4.3.',
      ].join('\n'),
    );
    expect(calls.map((c) => c.path)).toEqual([
      '/projects/by_slug',
      '/milestones',
      '/milestones/101',
      '/milestones/101/stats',
    ]);
  });

  it('reads a sprint by name, and says why a sprint without points has no burndown', async () => {
    const { ask } = await acmeServer();

    expect(await ask('get_sprint', { sprint: 'sprint 8' })).toBe(
      [
        'Sprint "Sprint 8" of Acme Billing · 2026-03-16 to 2026-03-27 · open',
        '',
        'Stories: no stories',
        'Tasks: no tasks',
        'Points: the team did not estimate this sprint',
        '',
        'No burndown: Taiga draws it from points, and none were given.',
      ].join('\n'),
    );
  });

  it('names the valid choices for a sprint that does not exist', async () => {
    const { refusal } = await acmeServer();

    expect(await refusal('get_sprint', { sprint: 'Sprint 99' })).toBe(
      'Project "Acme Billing" has no sprint "Sprint 99". Pass a sprint name from list_sprints, or "current".',
    );
  });
});

describe('get_attachment', () => {
  const PDF_HEADING =
    'File 1: bank-reply.pdf · 84 KB · attached to User story #42 of Acme Billing · note: What the bank answered';

  it('reads a file by the number get_item shows, or by part of its name', async () => {
    const { ask } = await acmeServer();
    const whole = [
      PDF_HEADING,
      'Read as: PDF, 2 pages.',
      '',
      '--- Page 1 ---',
      'Dear Acme,',
      '--- Page 2 ---',
      'The sandbox key is ready.',
    ].join('\n');

    expect(await ask('get_attachment', { ref: 42, file: 1 })).toBe(whole);
    expect(await ask('get_attachment', { ref: 42, file: '1' })).toBe(whole);
    expect(await ask('get_attachment', { ref: 42, file: 'bank' })).toBe(whole);
  });

  it('fetches the file without the Taiga token, and only once', async () => {
    const { ask, calls } = await acmeServer();

    await ask('get_attachment', { ref: 42, file: 1 });
    const download = calls.find((c) => c.path === '/files/bank-reply.pdf');
    // The address is signed by Taiga and may be on another host: the token stays with the API.
    expect(download).toBeDefined();
    expect(download?.headers['authorization']).toBeUndefined();

    // Asking for another part of the same file reads what is already in memory.
    expect(await ask('get_attachment', { ref: 42, file: 1, find: 'SANDBOX' })).toBe(
      [
        PDF_HEADING,
        'Read as: PDF, 2 pages.',
        'Lines containing "SANDBOX": 1.',
        '',
        'Page 2: The sandbox key is ready.',
        '',
        'Read a whole page with `pages`.',
      ].join('\n'),
    );
    expect(await ask('get_attachment', { ref: 42, file: 1, pages: '2' })).toContain(
      'The sandbox key is ready.',
    );
    expect(calls.filter((c) => c.path === '/files/bank-reply.pdf')).toHaveLength(1);
  });

  it('hands an image over as an image', async () => {
    const { call } = await acmeServer();

    const answer = await call('get_attachment', { ref: 57, file: 'total.png' });
    expect(answer.isError).toBe(false);
    expect(answer.parts).toEqual([
      { type: 'text', text: 'File 1: total.png · 16 B · attached to Issue #57 of Acme Billing' },
      { type: 'image', mimeType: 'image/png', data: expect.stringMatching(/^iVBOR/) as unknown },
    ]);
  });

  it('gives a large workbook as an overview first, then the rows asked for', async () => {
    const big = xlsx(3000);
    const { ask } = await acmeServer((request) => {
      if (request.path === '/userstories/attachments') {
        return json([
          { name: 'orders.xlsx', size: big.byteLength, url: `${BASE}/files/orders.xlsx`, sha1: 'xlsx1' },
        ]);
      }
      if (request.path === '/files/orders.xlsx') return new Response(big);
      return undefined;
    });

    const heading = 'File 1: orders.xlsx · 38 KB · attached to User story #42 of Acme Billing';
    expect(await ask('get_attachment', { ref: 42, file: 1 })).toBe(
      [
        heading,
        'Read as: spreadsheet, 2 sheets; formulas show their last value. Each line is "row number: cells split by |".',
        'Too large to show at once; this is an overview with the first 10 rows of each sheet.',
        '',
        '=== Sheet "Budget": 3003 rows with data, up to 3 columns ===',
        '1: Item |  | Cost (VND)',
        '2: Bank <sandbox> |  | 1500000',
        // Row 3 of the file is empty: the numbers are the ones Excel shows.
        '4: Paid | TRUE',
        '5: Line 5 |  | 0',
        '6: Line 6 |  | 1',
        '7: Line 7 |  | 2',
        '8: Line 8 |  | 3',
        '9: Line 9 |  | 4',
        '10: Line 10 |  | 5',
        '11: Line 11 |  | 6',
        '… 2993 more rows',
        '',
        '=== Sheet "Notes & links": 1 row with data, up to 1 column ===',
        '1: See wiki',
        '',
        'To read more: `sheet` with `rows` (e.g. "11-300"), or `find` with words to get only the rows that contain them.',
      ].join('\n'),
    );

    expect(await ask('get_attachment', { ref: 42, file: 1, sheet: '1', rows: '1500-1502' })).toBe(
      [
        heading,
        'Read as: spreadsheet, 2 sheets; formulas show their last value. Each line is "row number: cells split by |".',
        'Sheet "Budget", rows 1500 to 1502: 3 with data.',
        '',
        '(header) 1: Item |  | Cost (VND)',
        '1500: Line 1500 |  | 1495',
        '1501: Line 1501 |  | 1496',
        '1502: Line 1502 |  | 1497',
      ].join('\n'),
    );
  });

  it('does not download a file that is too large, and says what to do instead', async () => {
    const { refusal } = await acmeServer();

    expect(await refusal('get_attachment', { ref: 57, file: 2 })).toBe(
      'The file is at least 50.0 MB; this server reads files up to 10.0 MB. Open it in Taiga instead.',
    );
  });

  it('lists the files there are when the one asked for is not among them', async () => {
    const { refusal } = await acmeServer();

    expect(await refusal('get_attachment', { ref: 57, file: 3 })).toBe(
      'Issue #57 has no file "3". Its files: 1. total.png, 2. dump.log.',
    );
    expect(await refusal('get_attachment', { ref: 12, file: 1 })).toBe('Epic #12 has no attached files.');
    expect(await refusal('get_attachment', { ref: 999, file: 1 })).toContain('has no item #999');
  });
});

describe('the history of an item', () => {
  /** 45 status changes, newest first. */
  const LONG_HISTORY = Array.from({ length: 45 }, (_, index) => ({
    created_at: `2026-02-${String(28 - Math.floor(index / 2)).padStart(2, '0')}T08:00:00.000Z`,
    user: { name: 'Kiet', username: 'kiet' },
    comment: '',
    delete_comment_date: null,
    values_diff: { status: [`Step ${45 - index - 1}`, `Step ${45 - index}`] },
  }));
  const longHistory = (request: Call) =>
    request.path === '/history/userstory/1002' && request.query['type'] === 'activity'
      ? paged(LONG_HISTORY, request)
      : undefined;

  it('is shown when a page of it is asked for, and says where the older part is', async () => {
    const { ask } = await acmeServer(longHistory);

    const first = await ask('get_item', { ref: 42, changes_page: 1 });
    expect(first).toContain('Changes (page 1 of 3, 45 history entries in all, newest first):');
    expect(first).toContain('status: Step 44 → Step 45');
    expect(first).toContain('status: Step 25 → Step 26');
    expect(first).not.toContain('status: Step 24 → Step 25');
    expect(first).toContain('Older changes: call again with `changes_page`: 2.');

    const last = await ask('get_item', { ref: 42, changes_page: 3 });
    expect(last).toContain('Changes (page 3 of 3, 45 history entries in all, newest first):');
    expect(last).toContain('status: Step 0 → Step 1');
    expect(last).not.toContain('Older changes');
  });

  it('is left out unless asked for, and a page that does not exist is said to be missing', async () => {
    const { ask, refusal } = await acmeServer(longHistory);

    expect(await ask('get_item', { ref: 42 })).not.toContain('Changes');
    expect(await refusal('get_item', { ref: 42, changes_page: 4 })).toBe(
      'The history of #42 has no page 4. Call with `changes_page`: 1 to see how many pages there are.',
    );
  });
});
