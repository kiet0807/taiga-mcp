import { describe, expect, it } from 'vitest';
import { acmeClient, STORIES } from './acme.js';
import { json, paged } from './fake-taiga.js';

const SLUG = 'acme-billing';

describe('projects by slug', () => {
  it('looks the project up once for several questions, and again after a minute', async () => {
    const { client, queries, clock } = acmeClient();
    await client.listUserStories(SLUG, { limit: 30 });
    await client.listIssues('Acme-Billing ', { limit: 30 });
    expect(queries('/projects/by_slug')).toEqual([{ slug: SLUG }]);

    clock.now = new Date(clock.now.getTime() + 61_000);
    await client.listEpics(SLUG, { limit: 30 });
    expect(queries('/projects/by_slug')).toHaveLength(2);
  });

  it('says how to find the slug when there is no such project, and asks again next time', async () => {
    const { client, queries } = acmeClient();
    await expect(client.listSprints('acme', { limit: 30 })).rejects.toThrow(
      /No project with slug "acme".*list_projects/,
    );
    await expect(client.listSprints('acme', { limit: 30 })).rejects.toThrow(/No project/);
    expect(queries('/projects/by_slug')).toHaveLength(2);
    expect(queries('/milestones')).toHaveLength(0);
  });
});

describe('lists', () => {
  it('asks for `limit` items and reports how many there are in all', async () => {
    const { client, queries } = acmeClient();
    const stories = await client.listUserStories(SLUG, { limit: 2 });

    expect(queries('/userstories')).toEqual([{ project: '10', page_size: '2' }]);
    expect(stories.items.map((s) => s.ref)).toEqual([41, 42]);
    expect(stories.total).toBe(3);
    expect(stories.project).toBe('Acme Billing');
  });

  it('falls back to the number of items when Taiga sends no count', async () => {
    const { client } = acmeClient((call) => (call.path === '/userstories' ? json(STORIES) : undefined));
    expect((await client.listUserStories(SLUG, { limit: 30 })).total).toBe(3);
  });

  it('trims a story to what the list shows', async () => {
    const { client } = acmeClient();
    const [first, second, third] = (await client.listUserStories(SLUG, { limit: 30 })).items;
    expect(first).toEqual({
      ref: 41,
      subject: 'Export invoices\n as PDF',
      status: 'In progress',
      closed: false,
      assignee: 'Linh Tran',
      blocked: false,
      sprint: 'Sprint 7',
      points: 5,
    });
    expect(second).toMatchObject({ assignee: undefined, points: undefined, blocked: true });
    expect(third).toMatchObject({ status: 'Done', closed: true, sprint: undefined });
  });

  it('turns names into the ids Taiga filters by', async () => {
    const { client, queries } = acmeClient();
    await client.listUserStories(SLUG, {
      status: ' in PROGRESS',
      closed: false,
      assignedToMe: true,
      limit: 30,
    });
    expect(queries('/userstories')[0]).toEqual({
      project: '10',
      status: '2',
      status__is_closed: 'false',
      assigned_to: '7',
      page_size: '30',
    });

    await client.listIssues(SLUG, {
      status: 'needs info',
      severity: 'critical',
      priority: 'High',
      limit: 10,
    });
    expect(queries('/issues')[0]).toEqual({
      project: '10',
      status: '12',
      severity: '32',
      priority: '42',
      order_by: '-created_date',
      page_size: '10',
    });
  });

  it('answers an unknown name with the names that exist, without asking Taiga for the list', async () => {
    const { client, queries } = acmeClient();
    await expect(client.listUserStories(SLUG, { status: 'Doing', limit: 30 })).rejects.toThrow(
      'Project "Acme Billing" has no user story status "Doing". It has: New, In progress, Done.',
    );
    await expect(client.listIssues(SLUG, { severity: 'Blocker', limit: 30 })).rejects.toThrow(
      /no severity "Blocker". It has: Minor, Critical\./,
    );
    await expect(client.listIssues(SLUG, { status: 'Done', limit: 30 })).rejects.toThrow(
      /no issue status "Done". It has: New, Needs Info, Closed\./,
    );
    expect(queries('/userstories')).toHaveLength(0);
    expect(queries('/issues')).toHaveLength(0);
  });

  it('names an issue’s type, severity and priority', async () => {
    const { client } = acmeClient();
    const [first] = (await client.listIssues(SLUG, { limit: 30 })).items;
    expect(first).toMatchObject({ ref: 57, type: 'Bug', severity: 'Critical', priority: 'High' });
  });

  it('lists epics with the progress of their stories', async () => {
    const { client, queries } = acmeClient();
    const epics = await client.listEpics(SLUG, { closed: false, limit: 30 });
    expect(queries('/epics')).toEqual([{ project: '10', status__is_closed: 'false', page_size: '30' }]);
    expect(epics.items[0]).toMatchObject({ ref: 12, stories: 8, storiesDone: 2.5, closed: false });
  });
});

describe('sprints', () => {
  it('lists open sprints by default and marks the one running today', async () => {
    const { client, queries } = acmeClient();
    const sprints = await client.listSprints(SLUG, { limit: 30 });

    expect(queries('/milestones')).toEqual([{ project: '10', closed: 'false', page_size: '30' }]);
    expect(sprints.items).toEqual([
      {
        name: 'Sprint 8',
        start: '2026-03-16',
        finish: '2026-03-27',
        closed: false,
        current: false,
        totalPoints: 0,
        closedPoints: 0,
        stories: 0,
        storiesDone: 0,
      },
      {
        name: 'Sprint 7',
        start: '2026-03-02',
        finish: '2026-03-13',
        closed: false,
        current: true,
        totalPoints: 13,
        closedPoints: 5,
        stories: 3,
        storiesDone: 1,
      },
    ]);
  });

  it('lists closed sprints on request', async () => {
    const { client } = acmeClient();
    const sprints = await client.listSprints(SLUG, { closed: true, limit: 30 });
    expect(sprints.items.map((s) => s.name)).toEqual(['Sprint 6']);
  });

  it('filters stories by a sprint name, by "backlog", and by "current"', async () => {
    const { client, queries } = acmeClient();

    const byName = await client.listUserStories(SLUG, { sprint: 'sprint 6', limit: 30 });
    expect(byName.sprint).toBe('sprint "Sprint 6"');
    const backlog = await client.listUserStories(SLUG, { sprint: 'Backlog', limit: 30 });
    expect(backlog.sprint).toBe('backlog (no sprint)');
    const current = await client.listUserStories(SLUG, { sprint: 'current', limit: 30 });
    expect(current.sprint).toBe('current sprint "Sprint 7"');

    expect(
      queries('/userstories').map(({ milestone, milestone__isnull }) => milestone ?? milestone__isnull),
    ).toEqual(['100', 'true', '101']);
  });

  it('lists the open sprints when none is running today', async () => {
    const { client, clock, queries } = acmeClient();
    clock.now = new Date(2026, 2, 14, 12, 0); // the Saturday between Sprint 7 and Sprint 8
    await expect(client.listUserStories(SLUG, { sprint: 'current', limit: 30 })).rejects.toThrow(
      'No sprint of project "Acme Billing" is running today (2026-03-14). Open sprints: ' +
        '"Sprint 8" (2026-03-16 to 2026-03-27), "Sprint 7" (2026-03-02 to 2026-03-13). ' +
        'Pass one of these names as `sprint`.',
    );
    expect(queries('/userstories')).toHaveLength(0);
  });

  it('says so when a project has no open sprint at all', async () => {
    const { client } = acmeClient((call) => (call.path === '/milestones' ? paged([], call) : undefined));
    await expect(client.listUserStories(SLUG, { sprint: 'current', limit: 30 })).rejects.toThrow(
      /no open sprint.*closed: true/,
    );
  });

  it('rejects a sprint name the project does not have', async () => {
    const { client } = acmeClient();
    await expect(client.listUserStories(SLUG, { sprint: 'Sprint 99', limit: 30 })).rejects.toThrow(
      /no sprint "Sprint 99".*list_sprints/,
    );
  });
});

describe('one item', () => {
  it('finds out what kind of item a number is, then reads it with its comments', async () => {
    const { client, calls, queries } = acmeClient();
    const story = await client.getItem(SLUG, 42);

    expect(queries('/resolver')).toEqual([{ project: SLUG, ref: '42' }]);
    expect(queries('/history/userstory/1002')).toEqual([{ type: 'comment', page_size: '10' }]);
    // The project defines no custom fields for stories, so their values are not requested.
    expect(calls.some((c) => c.path.includes('custom-attributes-values'))).toBe(false);

    expect(story).toEqual({
      kind: 'story',
      project: 'Acme Billing',
      ref: 42,
      subject: 'Retry failed card payments',
      status: 'New',
      closed: false,
      assignee: undefined,
      blocked: true,
      blockedNote: 'Waiting for the bank sandbox',
      description: 'When a card payment fails, retry it **three times** over 24 hours.',
      createdBy: 'Linh Tran',
      created: '2026-03-01',
      modified: '2026-03-09',
      tags: ['payments', 'backend'],
      facts: [
        ['Sprint', 'Sprint 7'],
        ['Epics', '#12 Card payments'],
      ],
      customFields: [],
      comments: [
        { author: 'Linh Tran', date: '2026-03-09', text: 'Sandbox access is promised for Thursday.' },
        { author: 'Kiet', date: '2026-03-05', text: 'Blocked: the bank sandbox rejects our key.' },
      ],
      totalComments: 2,
    });
  });

  it('reads an epic with its custom fields by name, leaving empty ones out', async () => {
    const { client } = acmeClient();
    const epic = await client.getItem(SLUG, 12);
    expect(epic).toMatchObject({
      kind: 'epic',
      facts: [['Stories', '8 stories, 31% done']],
      customFields: [
        ['Start date', '2026-01-05'],
        ['End date', '2026-02-27'],
      ],
      comments: [],
      totalComments: 0,
    });
  });

  it('reads an issue with its type, severity and priority by name', async () => {
    const { client } = acmeClient();
    expect(await client.getItem(SLUG, 57)).toMatchObject({
      kind: 'issue',
      tags: [],
      facts: [
        ['Type', 'Bug'],
        ['Severity', 'Critical'],
        ['Priority', 'High'],
      ],
    });
  });

  it('explains a number that is a task, or that nothing has', async () => {
    const { client } = acmeClient();
    await expect(client.getItem(SLUG, 70)).rejects.toThrow(/#70 .* is a task/);
    await expect(client.getItem(SLUG, 999)).rejects.toThrow(/has no item #999/);
  });
});
