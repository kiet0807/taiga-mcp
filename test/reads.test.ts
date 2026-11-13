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
        ['Due', '2026-03-13'],
        ['Sprint', 'Sprint 7'],
        ['Epics', '#12 Card payments'],
      ],
      customFields: [],
      comments: [
        { author: 'Linh Tran', date: '2026-03-09', text: 'Sandbox access is promised for Thursday.' },
        { author: 'Kiet', date: '2026-03-05', text: 'Blocked: the bank sandbox rejects our key.' },
      ],
      totalComments: 2,
      tasks: [
        expect.objectContaining({ ref: 70, status: 'In progress', story: 42 }),
        expect.objectContaining({ ref: 71, blocked: true }),
      ],
      // The file that was replaced by a newer one is left out.
      attachments: [
        {
          name: 'bank-reply.pdf',
          size: 86_016,
          url: 'https://taiga.example/files/bank-reply.pdf',
          note: 'What the bank answered',
        },
      ],
      changes: undefined,
      totalChanges: 0,
    });
    expect(queries('/tasks')).toEqual([{ project: '10', user_story: '1002' }]);
  });

  it('reads more comments, or none, on request', async () => {
    const { client, queries } = acmeClient();
    const one = await client.getItem(SLUG, 42, { comments: 1 });
    expect(one.comments).toHaveLength(1);
    expect(one.totalComments).toBe(2);

    const none = await client.getItem(SLUG, 42, { comments: 0 });
    expect(none.comments).toBeUndefined();
    expect(queries('/history/userstory/1002')).toEqual([{ type: 'comment', page_size: '2' }]);
  });

  it('tells who changed what, leaving out moves on the board', async () => {
    const { client, queries } = acmeClient();
    const story = await client.getItem(SLUG, 42, { changes: true });

    expect(queries('/history/userstory/1002')).toContainEqual({ type: 'activity', page_size: '20' });
    expect(story.changes).toEqual([
      { author: 'Linh Tran', date: '2026-03-06', what: 'is blocked: false → true; blocked note edited' },
      {
        author: 'Kiet',
        date: '2026-03-02',
        what: 'sprint: none → Sprint 7; assigned to: Linh Tran → none; points (Back): ? → 5',
      },
    ]);
    expect(story.totalChanges).toBe(3);
  });

  it('reads an item whose files the user may not see, without them', async () => {
    const { client } = acmeClient((call) =>
      call.path === '/userstories/attachments' ? json({ _error_message: 'no' }, 403) : undefined,
    );
    expect((await client.getItem(SLUG, 42)).attachments).toEqual([]);
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

  it('reads a task with the story and sprint it belongs to', async () => {
    const { client, queries } = acmeClient();
    expect(await client.getItem(SLUG, 70)).toMatchObject({
      kind: 'task',
      ref: 70,
      status: 'In progress',
      assignee: 'Linh Tran',
      description: 'The key we have is rejected. Ask for one the sandbox accepts.',
      facts: [
        ['User story', '#42 Retry failed card payments'],
        ['Sprint', 'Sprint 7'],
      ],
    });
    expect(queries('/history/task/4001')).toHaveLength(1);
  });

  it('explains a number that nothing has', async () => {
    const { client } = acmeClient();
    await expect(client.getItem(SLUG, 999)).rejects.toThrow(/has no item #999/);
  });
});

describe('long lists', () => {
  it('asks Taiga for a later page', async () => {
    const { client, queries } = acmeClient();
    const second = await client.listUserStories(SLUG, { limit: 2, page: 2 });

    expect(queries('/userstories')).toEqual([{ project: '10', page_size: '2', page: '2' }]);
    expect(second.items.map((s) => s.ref)).toEqual([38]);
    expect(second.total).toBe(3);
  });

  it('pages sprints, issues, epics and tasks the same way', async () => {
    const { client, queries } = acmeClient();
    await client.listSprints(SLUG, { limit: 1, page: 2 });
    await client.listIssues(SLUG, { limit: 1, page: 2 });
    await client.listEpics(SLUG, { limit: 1, page: 2 });
    await client.listTasks(SLUG, { limit: 1, page: 2 });
    for (const path of ['/milestones', '/issues', '/epics', '/tasks']) {
      expect(queries(path)[0], path).toMatchObject({ page_size: '1', page: '2' });
    }
  });

  it('says so when a page is past the end, instead of repeating Taiga’s 404', async () => {
    const { client } = acmeClient();
    await expect(client.listUserStories(SLUG, { limit: 2, page: 5 })).rejects.toThrow(
      'The list has no page 5 at 2 items a page. Call again with `page`: 1 to see how many items there are.',
    );
  });
});

describe('more filters', () => {
  it('filters by tag and by the days items were created and finished in', async () => {
    const { client, queries } = acmeClient();
    await client.listUserStories(SLUG, {
      tag: ' Backend ',
      createdFrom: '2026-03-01',
      createdTo: '2026-03-31',
      finishedFrom: '2026-03-10',
      finishedTo: '2026-03-20',
      limit: 30,
    });
    expect(queries('/userstories')[0]).toEqual({
      project: '10',
      tags: 'backend',
      created_date__gte: '2026-03-01',
      created_date__lte: '2026-03-31T23:59:59Z',
      finish_date__gte: '2026-03-10',
      finish_date__lte: '2026-03-20T23:59:59Z',
      page_size: '30',
    });

    // Tasks and issues call the same date by another name.
    await client.listTasks(SLUG, { finishedFrom: '2026-03-01', limit: 30 });
    await client.listIssues(SLUG, { finishedTo: '2026-03-31', limit: 30 });
    expect(queries('/tasks')[0]).toMatchObject({ finished_date__gte: '2026-03-01' });
    expect(queries('/issues')[0]).toMatchObject({ finished_date__lte: '2026-03-31T23:59:59Z' });
  });

  it('gives the day an item was finished', async () => {
    const { client } = acmeClient();
    const stories = await client.listUserStories(SLUG, { limit: 30 });
    expect(stories.items.map((story) => story.finished)).toEqual([undefined, undefined, '2026-02-20']);
    expect((await client.listTasks(SLUG, { limit: 30 })).items[2]?.finished).toBe('2026-03-04');
  });

  it('filters issues by type name', async () => {
    const { client, queries } = acmeClient();
    await client.listIssues(SLUG, { type: 'bug', limit: 30 });
    expect(queries('/issues')[0]).toMatchObject({ type: '51' });
    await expect(client.listIssues(SLUG, { type: 'Task', limit: 30 })).rejects.toThrow(
      /no issue type "Task". It has: Bug, Question\./,
    );
  });

  it('filters epics by status, person, tag and words, like the other lists', async () => {
    const { client, queries } = acmeClient();
    const epics = await client
      .listEpics(SLUG, {
        status: 'done',
        closed: true,
        assignedTo: 'linh tran',
        tag: 'payments',
        limit: 100,
        page: 2,
      })
      .catch((error: unknown) => error);
    // The fake has two epics, so page 2 of 100 does not exist; the query is what matters here.
    expect(String(epics)).toMatch(/no page 2/);
    expect(queries('/epics')[0]).toEqual({
      project: '10',
      status: '22',
      status__is_closed: 'true',
      assigned_to: '8',
      tags: 'payments',
      page_size: '100',
      page: '2',
    });

    const mine = await client.listEpics(SLUG, { assignedToMe: true, limit: 30 });
    expect(mine.assignee).toBe('me');
    await expect(client.listEpics(SLUG, { finishedFrom: '2026-01-01', limit: 30 })).rejects.toThrow(
      'Taiga keeps no finish date for epics. Filter them with `closed`.',
    );
  });
});

describe('the project itself', () => {
  it('gives the people, and the names its items use', async () => {
    const { client, queries } = acmeClient();
    const project = await client.getProject(SLUG);

    expect(project).toMatchObject({
      name: 'Acme Billing',
      slug: SLUG,
      description: 'Invoices and card payments for Acme.',
      isPrivate: true,
      modules: ['backlog', 'issues', 'epics', 'wiki'],
      tags: ['backend', 'payments'],
      openSprints: 2,
      closedSprints: 1,
      customFields: { story: [], issue: [], task: [], epic: ['Start date', 'End date', 'Budget'] },
    });
    expect(project.members[3]).toEqual({
      id: 11,
      username: 'duc',
      name: 'Đỗ Minh Đức',
      role: 'Product Owner',
    });
    expect(project.statuses.task).toEqual([
      { id: 71, name: 'New', closed: false },
      { id: 72, name: 'In progress', closed: false },
      { id: 73, name: 'Closed', closed: true },
    ]);
    // Everything comes with the project: no further request.
    expect(queries('/projects/by_slug')).toHaveLength(1);
  });
});

describe('the wiki', () => {
  it('lists pages with the title from the wiki menu', async () => {
    const { client, queries } = acmeClient();
    const pages = await client.listWikiPages(SLUG, { limit: 30 });

    expect(queries('/wiki')).toEqual([{ project: '10', order_by: '-modified_date', page_size: '30' }]);
    expect(pages.items).toEqual([
      { slug: 'release-steps', title: 'How we release', modified: '2026-03-01', edits: 4, length: 60 },
      { slug: 'home', title: undefined, modified: '2026-01-05', edits: 1, length: 8 },
    ]);
  });

  it('reads a page by slug or by title, and names who changed it last', async () => {
    const { client, queries } = acmeClient();
    const bySlug = await client.getWikiPage(SLUG, ' Release-Steps ');
    const byTitle = await client.getWikiPage(SLUG, 'how we release');

    expect(queries('/wiki/by_slug')).toEqual([
      { project: '10', slug: 'release-steps' },
      { project: '10', slug: 'release-steps' },
    ]);
    expect(byTitle).toEqual(bySlug);
    expect(bySlug).toMatchObject({
      project: 'Acme Billing',
      title: 'How we release',
      content: '# Release\n\n1. Freeze the branch.\n2. Run the payment checks.',
      created: '2026-01-10',
      modifiedBy: 'Linh Tran',
    });
  });

  it('says how to find the pages when there is no such page', async () => {
    const { client } = acmeClient();
    await expect(client.getWikiPage(SLUG, 'roadmap')).rejects.toThrow(
      'Project "Acme Billing" has no wiki page "roadmap". Call list_wiki_pages to see the pages.',
    );
  });

  it('finds pages by their text', async () => {
    const { client, queries } = acmeClient();
    expect(await client.searchWiki(SLUG, ' payment checks ')).toEqual([
      expect.objectContaining({ slug: 'release-steps', title: 'How we release' }),
    ]);
    expect(queries('/search')).toEqual([{ project: '10', text: 'payment checks' }]);
  });
});

describe('search', () => {
  it('sends the words to Taiga, for stories, issues, epics and tasks', async () => {
    const { client, queries } = acmeClient();
    await client.listUserStories(SLUG, { search: '  card retry ', limit: 30 });
    await client.listIssues(SLUG, { search: 'discount', limit: 30 });
    await client.listEpics(SLUG, { search: 'invoices', limit: 30 });
    await client.listTasks(SLUG, { search: 'sandbox', limit: 30 });

    expect(queries('/userstories')[0]).toEqual({ project: '10', q: 'card retry', page_size: '30' });
    expect(queries('/issues')[0]).toMatchObject({ q: 'discount' });
    expect(queries('/epics')[0]).toMatchObject({ q: 'invoices' });
    expect(queries('/tasks')[0]).toMatchObject({ q: 'sandbox' });
  });

  it('sends nothing for blank words', async () => {
    const { client, queries } = acmeClient();
    await client.listUserStories(SLUG, { search: '   ', limit: 30 });
    expect(queries('/userstories')[0]).toEqual({ project: '10', page_size: '30' });
  });
});

describe('whose items', () => {
  const assignedTo = async (name: string) => {
    const { client, queries } = acmeClient();
    const stories = await client.listUserStories(SLUG, { assignedTo: name, limit: 30 });
    return { id: queries('/userstories')[0]?.['assigned_to'], label: stories.assignee };
  };

  it('finds a member by full name or username, whatever the case', async () => {
    expect(await assignedTo('linh tran')).toEqual({ id: '8', label: 'Linh Tran' });
    expect(await assignedTo('DUC')).toEqual({ id: '11', label: 'Đỗ Minh Đức' });
  });

  it('finds a member by part of the name, and without the accents', async () => {
    expect(await assignedTo('tran')).toEqual({ id: '8', label: 'Linh Tran' });
    expect(await assignedTo('vo thi linh')).toEqual({ id: '9', label: 'Võ Thị Linh' });
    expect(await assignedTo('do minh')).toEqual({ id: '11', label: 'Đỗ Minh Đức' });
  });

  it('asks which one when a name fits several members', async () => {
    const { client, queries } = acmeClient();
    await expect(client.listIssues(SLUG, { assignedTo: 'Linh', limit: 30 })).rejects.toThrow(
      '"Linh" matches several members of project "Acme Billing": Linh Tran (linh.tran), Võ Thị Linh (vtlinh). ' +
        'Pass the full name or the username.',
    );
    expect(queries('/issues')).toHaveLength(0);
  });

  it('answers an unknown name with the members', async () => {
    const { client } = acmeClient();
    await expect(client.listTasks(SLUG, { assignedTo: 'Nam', limit: 30 })).rejects.toThrow(
      'Project "Acme Billing" has no member "Nam". Members: Kiet (kiet), Linh Tran (linh.tran), ' +
        'Võ Thị Linh (vtlinh), Đỗ Minh Đức (duc).',
    );
  });

  it('lists what nobody is assigned to', async () => {
    expect(await assignedTo('Unassigned')).toEqual({ id: 'null', label: 'nobody' });
  });

  it('labels the signed-in user’s items, and refuses two answers to "whose"', async () => {
    const { client, queries } = acmeClient();
    const mine = await client.listTasks(SLUG, { assignedToMe: true, limit: 30 });
    expect(mine.assignee).toBe('me');
    expect(queries('/tasks')[0]).toMatchObject({ assigned_to: '7' });

    await expect(
      client.listTasks(SLUG, { assignedToMe: true, assignedTo: 'Linh Tran', limit: 30 }),
    ).rejects.toThrow('Pass either `assigned_to_me` or `assigned_to`, not both.');
  });
});

describe('stories of an epic', () => {
  it('turns the epic’s reference number into the id Taiga filters by', async () => {
    const { client, queries } = acmeClient();
    await client.listUserStories(SLUG, { epic: 12, limit: 30 });
    expect(queries('/resolver')).toEqual([{ project: SLUG, ref: '12' }]);
    expect(queries('/userstories')[0]).toEqual({ project: '10', epic: '3001', page_size: '30' });
  });

  it('says what a number is when it is not an epic, and when nothing has it', async () => {
    const { client, queries } = acmeClient();
    await expect(client.listUserStories(SLUG, { epic: 42, limit: 30 })).rejects.toThrow(
      '#42 in project "Acme Billing" is a user story, not an epic. Call list_epics for the epic numbers.',
    );
    await expect(client.listUserStories(SLUG, { epic: 999, limit: 30 })).rejects.toThrow(
      'Project "Acme Billing" has no epic #999. Call list_epics for the epic numbers.',
    );
    expect(queries('/userstories')).toHaveLength(0);
  });
});

describe('tasks', () => {
  it('lists the tasks of a story, a sprint and a status by name', async () => {
    const { client, queries } = acmeClient();
    const tasks = await client.listTasks(SLUG, {
      story: 42,
      sprint: 'current',
      status: 'in progress',
      closed: false,
      limit: 30,
    });

    expect(queries('/tasks')).toEqual([
      {
        project: '10',
        user_story: '1002',
        milestone: '101',
        status: '72',
        status__is_closed: 'false',
        page_size: '30',
      },
    ]);
    expect(tasks.sprint).toBe('current sprint "Sprint 7"');
    expect(tasks.items[0]).toEqual({
      ref: 70,
      subject: 'Ask the bank for a sandbox key',
      status: 'In progress',
      closed: false,
      assignee: 'Linh Tran',
      blocked: false,
      story: 42,
      sprint: 'Sprint 7',
      finished: undefined,
    });

    const all = await client.listTasks(SLUG, { limit: 30 });
    expect(all.items[2]).toMatchObject({ ref: 72, story: undefined, sprint: undefined, closed: true });
  });

  it('uses the task statuses of the project, not those of stories', async () => {
    const { client } = acmeClient();
    await expect(client.listTasks(SLUG, { status: 'Done', limit: 30 })).rejects.toThrow(
      /no task status "Done". It has: New, In progress, Closed\./,
    );
  });

  it('says what a number is when it is not a story', async () => {
    const { client } = acmeClient();
    await expect(client.listTasks(SLUG, { story: 57, limit: 30 })).rejects.toThrow(
      '#57 in project "Acme Billing" is an issue, not a user story. Call list_user_stories for the story numbers.',
    );
  });

  it('explains that tasks have no backlog, and how to get there', async () => {
    const { client, queries } = acmeClient();
    await expect(client.listTasks(SLUG, { sprint: 'backlog', limit: 30 })).rejects.toThrow(
      /Tasks cannot be listed by backlog.*list_user_stories/,
    );
    await expect(client.listTasks(SLUG, { sprint: 'Sprint 99', limit: 30 })).rejects.toThrow(
      'Project "Acme Billing" has no sprint "Sprint 99". Pass a sprint name from list_sprints or "current".',
    );
    expect(queries('/tasks')).toHaveLength(0);
  });
});
