import { TaigaClient } from '../src/taiga/client.js';
import { BASE, fakeTaiga, json, paged, USER, type Call } from './fake-taiga.js';
import { pdfWith, PNG } from './fake-files.js';

/**
 * "Acme Billing": an invented project, shaped like what Taiga's API returns (with the many
 * fields this server ignores left out). The fake does not filter: tests check the query that
 * was sent, and what the server makes of the answer.
 */

const status = (name: string, is_closed = false) => ({ name, is_closed, color: '#999' });
const person = (full_name_display: string) => ({ full_name_display, username: 'x', photo: null });

export const PROJECT = {
  id: 10,
  name: 'Acme Billing',
  slug: 'acme-billing',
  description: 'Invoices and card payments for Acme.',
  is_private: true,
  is_backlog_activated: true,
  is_kanban_activated: false,
  is_issues_activated: true,
  is_epics_activated: true,
  is_wiki_activated: true,
  tags_colors: { payments: '#c00', backend: null },
  us_statuses: [
    { id: 1, name: 'New', is_closed: false },
    { id: 2, name: 'In progress', is_closed: false },
    { id: 3, name: 'Done', is_closed: true },
  ],
  issue_statuses: [
    { id: 11, name: 'New', is_closed: false },
    { id: 12, name: 'Needs Info', is_closed: false },
    { id: 13, name: 'Closed', is_closed: true },
  ],
  epic_statuses: [
    { id: 21, name: 'In progress', is_closed: false },
    { id: 22, name: 'Done', is_closed: true },
  ],
  task_statuses: [
    { id: 71, name: 'New', is_closed: false },
    { id: 72, name: 'In progress', is_closed: false },
    { id: 73, name: 'Closed', is_closed: true },
  ],
  severities: [
    { id: 31, name: 'Minor' },
    { id: 32, name: 'Critical' },
  ],
  priorities: [
    { id: 41, name: 'Low' },
    { id: 42, name: 'High' },
  ],
  issue_types: [
    { id: 51, name: 'Bug' },
    { id: 52, name: 'Question' },
  ],
  milestones: [
    { id: 102, name: 'Sprint 8', slug: 'sprint-8', closed: false },
    { id: 101, name: 'Sprint 7', slug: 'sprint-7', closed: false },
    { id: 100, name: 'Sprint 6', slug: 'sprint-6', closed: true },
  ],
  userstory_custom_attributes: [],
  issue_custom_attributes: [],
  epic_custom_attributes: [
    { id: 61, name: 'Start date' },
    { id: 62, name: 'End date' },
    { id: 63, name: 'Budget' },
  ],
  task_custom_attributes: [],
  members: [
    { id: 7, username: 'kiet', full_name_display: 'Kiet', role_name: 'Back' },
    { id: 8, username: 'linh.tran', full_name_display: 'Linh Tran', role_name: 'Front' },
    { id: 9, username: 'vtlinh', full_name_display: 'Võ Thị Linh', role_name: 'QA' },
    { id: 11, username: 'duc', full_name_display: 'Đỗ Minh Đức', role_name: 'Product Owner' },
  ],
};

/** "Today" in the tests: inside Sprint 7, before Sprint 8. */
export const TODAY = new Date(2026, 2, 10, 9, 0);

export const SPRINTS = [
  {
    id: 102,
    name: 'Sprint 8',
    estimated_start: '2026-03-16',
    estimated_finish: '2026-03-27',
    closed: false,
    total_points: 0,
    closed_points: null,
    user_stories: [],
  },
  {
    id: 101,
    name: 'Sprint 7',
    estimated_start: '2026-03-02',
    estimated_finish: '2026-03-13',
    closed: false,
    total_points: 13,
    closed_points: 5,
    user_stories: [
      { status_extra_info: { is_closed: true } },
      { is_closed: true, status_extra_info: { is_closed: false } },
      { status_extra_info: { is_closed: false } },
    ],
  },
  {
    id: 100,
    name: 'Sprint 6',
    estimated_start: '2026-02-16',
    estimated_finish: '2026-02-27',
    closed: true,
    total_points: 21,
    closed_points: 21,
    user_stories: [{ status_extra_info: { is_closed: true } }],
  },
];

export const STORIES = [
  {
    id: 1001,
    ref: 41,
    subject: 'Export invoices\n as PDF',
    status_extra_info: status('In progress'),
    assigned_to_extra_info: person('Linh Tran'),
    milestone_name: 'Sprint 7',
    total_points: 5,
    is_blocked: false,
  },
  {
    id: 1002,
    ref: 42,
    subject: 'Retry failed card payments',
    status_extra_info: status('New'),
    assigned_to_extra_info: null,
    milestone_name: 'Sprint 7',
    total_points: null,
    is_blocked: true,
    blocked_note: 'Waiting for the bank sandbox',
  },
  {
    id: 1003,
    ref: 38,
    subject: 'Monthly statement email',
    status_extra_info: status('Done', true),
    assigned_to_extra_info: person('Kiet'),
    milestone_name: null,
    total_points: 3,
    is_blocked: false,
    finish_date: '2026-02-20T16:45:00.000Z',
  },
];

export const ISSUES = [
  {
    id: 2001,
    ref: 57,
    subject: 'Total is wrong when a discount applies',
    status_extra_info: status('New'),
    assigned_to_extra_info: person('Kiet'),
    severity: 32,
    priority: 42,
    type: 51,
  },
  {
    id: 2002,
    ref: 55,
    subject: 'Which currencies are supported?',
    status_extra_info: status('Closed', true),
    assigned_to_extra_info: null,
    severity: 31,
    priority: 41,
    type: 52,
  },
];

export const EPICS = [
  {
    id: 3001,
    ref: 12,
    subject: 'Card payments',
    status_extra_info: status('In progress'),
    assigned_to_extra_info: person('Linh Tran'),
    user_stories_counts: { total: 8, progress: 2.5 },
  },
  {
    id: 3002,
    ref: 9,
    subject: 'Invoices',
    status_extra_info: status('Done', true),
    assigned_to_extra_info: null,
    user_stories_counts: { total: 0, progress: 0 },
  },
];

const RETRY_STORY = { id: 1002, ref: 42, subject: 'Retry failed card payments', epics: null };

export const TASKS = [
  {
    id: 4001,
    ref: 70,
    subject: 'Ask the bank for a sandbox key',
    status_extra_info: status('In progress'),
    assigned_to_extra_info: person('Linh Tran'),
    user_story_extra_info: RETRY_STORY,
    milestone: 101,
    is_blocked: false,
  },
  {
    id: 4002,
    ref: 71,
    subject: 'Schedule the three retries',
    status_extra_info: status('New'),
    assigned_to_extra_info: null,
    user_story_extra_info: RETRY_STORY,
    milestone: 101,
    is_blocked: true,
  },
  {
    id: 4003,
    ref: 72,
    subject: 'Rotate the API key',
    status_extra_info: status('Closed', true),
    assigned_to_extra_info: person('Kiet'),
    user_story_extra_info: null,
    milestone: null,
    is_blocked: false,
    finished_date: '2026-03-04T11:00:00.000Z',
  },
];

const TASK_DETAIL = {
  ...TASKS[0],
  description: 'The key we have is rejected. Ask for one the sandbox accepts.',
  owner_extra_info: person('Kiet'),
  created_date: '2026-03-03T08:00:00.000Z',
  modified_date: '2026-03-09T09:30:00.000Z',
  tags: [],
};

const STORY_DETAIL = {
  ...STORIES[1],
  description: 'When a card payment fails, retry it **three times** over 24 hours.\n',
  owner_extra_info: person('Linh Tran'),
  created_date: '2026-03-01T08:15:00.000Z',
  modified_date: '2026-03-09T10:00:00.000Z',
  tags: [['payments', '#c00'], 'backend'],
  epics: [{ id: 3001, ref: 12, subject: 'Card payments' }],
  due_date: '2026-03-13',
  // Linh, and someone who has left the project since.
  watchers: [8, 404],
  total_voters: 2,
};

/** Newest first. The second file was replaced by a newer one and is marked as such in Taiga. */
const STORY_FILES = [
  {
    name: 'bank-reply.pdf',
    size: 86_016,
    url: 'https://taiga.example/files/bank-reply.pdf',
    description: 'What the bank answered',
    is_deprecated: false,
    sha1: 'a1b2c3',
  },
  {
    name: 'old-flow.png',
    size: 2_400_000,
    url: 'https://taiga.example/files/old-flow.png',
    is_deprecated: true,
  },
];

/** The issue's screenshot: a PNG, and a second file that is too large to read. */
const ISSUE_FILES = [
  {
    name: 'total.png',
    size: PNG.byteLength,
    url: `${BASE}/files/total.png`,
    sha1: 'png1',
    is_deprecated: false,
  },
  {
    name: 'dump.log',
    size: 50 * 1024 * 1024,
    url: `${BASE}/files/dump.log`,
    sha1: 'log1',
    is_deprecated: false,
  },
];

/** What the stored files hold, by path below the host. */
export const FILES: Record<string, { body: Uint8Array; type: string; length?: number }> = {
  '/files/bank-reply.pdf': {
    body: pdfWith(['Dear Acme,', 'The sandbox key is ready.']),
    type: 'application/pdf',
  },
  '/files/total.png': { body: PNG, type: 'image/png' },
  '/files/dump.log': { body: new TextEncoder().encode('x'), type: 'text/plain', length: 50 * 1024 * 1024 },
};

/** Sprint 7 as Taiga's statistics give it: one task in three done, and a burndown. */
const SPRINT_7_STATS = {
  total_tasks: 3,
  completed_tasks: 1,
  total_points: { '1': 13 },
  completed_points: [5],
  iocaine_doses: 1,
  days: ['02', '03', '04', '05', '06', '09', '10', '11', '12', '13'].map((d, i) => ({
    day: `2026-03-${d}`,
    name: i,
    open_points: [13, 13, 13, 11, 11, 8, 8, 8, 8, 8][i],
    optimal_points: Math.round((13 - (13 / 9) * i) * 1000) / 1000,
  })),
};

const event = (
  created: string,
  event_type: string,
  name: string,
  data: Record<string, unknown>,
  project = 10,
) => ({
  created,
  event_type,
  data: { user: { name, username: 'x' }, project: { id: project }, comment: '', values_diff: {}, ...data },
});

const story42 = { id: 1002, ref: 42, subject: 'Retry failed card payments' };

/** The project's activity, newest first, as `/timeline` gives it. */
export const TIMELINE = [
  event('2026-03-10T09:00:00.000Z', 'tasks.task.change', 'Linh Tran', {
    task: { id: 4001, ref: 70, subject: 'Ask the bank for a sandbox key', userstory: story42 },
    values_diff: { status: ['New', 'In progress'], taskboard_order: [1, 2] },
  }),
  event('2026-03-09T10:00:00.000Z', 'userstories.userstory.change', 'Linh Tran', {
    userstory: story42,
    comment: 'Sandbox access is promised for Thursday.',
  }),
  // Only moved on the board: says nothing, so it is left out.
  event('2026-03-08T12:00:00.000Z', 'userstories.userstory.change', 'Kiet', {
    userstory: { id: 1001, ref: 41, subject: 'Export invoices as PDF' },
    values_diff: { backlog_order: [1, 2] },
  }),
  event('2026-03-07T08:00:00.000Z', 'tasks.task.create', 'Kiet', {
    task: { id: 4002, ref: 71, subject: 'Schedule the three retries', userstory: story42 },
  }),
  event('2026-03-06T08:00:00.000Z', 'epics.relateduserstory.create', 'Kiet', {
    epic: { id: 3001, ref: 12, subject: 'Card payments' },
    userstory: story42,
    relateduserstory: { id: 1, subject: 'Retry failed card payments' },
  }),
  event('2026-03-05T08:00:00.000Z', 'wiki.wikipage.change', 'Linh Tran', {
    wikipage: { id: 1, slug: 'release-steps' },
    values_diff: { content_diff: ['a', 'b'], content_html: ['a', 'b'] },
  }),
  // Kiet in another project: not part of this one's activity.
  event(
    '2026-03-04T08:00:00.000Z',
    'issues.issue.create',
    'Kiet',
    { issue: { id: 9, ref: 3, subject: 'Elsewhere' } },
    77,
  ),
  event('2026-03-01T08:00:00.000Z', 'milestones.milestone.create', 'Kiet', {
    milestone: { id: 102, name: 'Sprint 8' },
  }),
  event('2026-02-28T08:00:00.000Z', 'issues.issue.delete', 'Kiet', {
    issue: { id: 2003, ref: 50, subject: 'Duplicate of #57' },
  }),
];

const change = (created_at: string, name: string, values_diff: Record<string, unknown>) => ({
  created_at,
  user: { name, username: 'x' },
  comment: '',
  delete_comment_date: null,
  values_diff,
});

/** Newest first: what happened to story #42 besides the comments. */
export const STORY_CHANGES = [
  change('2026-03-06T08:00:00.000Z', 'Linh Tran', {
    is_blocked: [false, true],
    blocked_note_diff: [null, '<ins>Waiting</ins>'],
    blocked_note_html: ['', '<p>Waiting</p>'],
  }),
  change('2026-03-04T10:00:00.000Z', 'Kiet', { sprint_order: [3, 1], backlog_order: [9, 2] }),
  change('2026-03-02T09:00:00.000Z', 'Kiet', {
    milestone: [null, 'Sprint 7'],
    assigned_to: ['Linh Tran', ''],
    points: { Back: ['?', '5'] },
  }),
];

export const WIKI_PAGES = [
  {
    slug: 'release-steps',
    content: '# Release\n\n1. Freeze the branch.\n2. Run the payment checks.\n',
    created_date: '2026-01-10T08:00:00.000Z',
    modified_date: '2026-03-01T08:00:00.000Z',
    editions: 4,
    last_modifier: 8,
  },
  {
    slug: 'home',
    content: 'Welcome.',
    created_date: '2026-01-05T08:00:00.000Z',
    modified_date: '2026-01-05T08:00:00.000Z',
    editions: 1,
    last_modifier: 7,
  },
];

const WIKI_LINKS = [{ title: 'How we release', href: 'release-steps' }];

const EPIC_DETAIL = {
  ...EPICS[0],
  description: '',
  owner_extra_info: person('Kiet'),
  created_date: '2026-01-05T08:00:00.000Z',
  modified_date: '2026-03-08T08:00:00.000Z',
  tags: [],
};

const ISSUE_DETAIL = { ...ISSUES[0], description: 'Steps to reproduce: …', tags: null };

const comment = (created_at: string, name: string, text: string, deleted = false) => ({
  created_at,
  user: { name, username: 'x' },
  comment: text,
  delete_comment_date: deleted ? '2026-03-09T00:00:00.000Z' : null,
});

/** Newest first, as Taiga sends them. */
export const STORY_COMMENTS = [
  comment('2026-03-09T10:00:00.000Z', 'Linh Tran', 'Sandbox access is promised for Thursday.'),
  comment('2026-03-08T09:00:00.000Z', 'Kiet', 'posted by mistake', true),
  comment('2026-03-05T09:00:00.000Z', 'Kiet', 'Blocked: the bank sandbox rejects our key.'),
];

const notFound = () => json({ _error_message: 'Not found' }, 404);

/** Answers like Taiga would for the Acme project. `override` may answer a call first. */
export function acme(override: (call: Call) => Response | undefined = () => undefined) {
  return fakeTaiga((call) => {
    const overridden = override(call);
    if (overridden !== undefined) return overridden;
    const { path, query } = call;
    switch (path) {
      case '/users/me':
        return json(USER);
      case '/projects/by_slug':
        return query['slug'] === PROJECT.slug ? json(PROJECT) : notFound();
      case '/milestones':
        return paged(
          SPRINTS.filter((sprint) => String(sprint.closed) === query['closed']),
          call,
        );
      case '/userstories':
        return paged(STORIES, call);
      case '/issues':
        return paged(ISSUES, call);
      case '/epics':
        return paged(EPICS, call);
      case '/tasks':
        // The tasks of one story, when asked for them.
        return paged(
          TASKS.filter(
            (task) =>
              query['user_story'] === undefined ||
              String(task.user_story_extra_info?.id) === query['user_story'],
          ),
          call,
        );
      case '/userstories/attachments':
        return json(query['object_id'] === '1002' ? STORY_FILES : []);
      case '/issues/attachments':
        return json(query['object_id'] === '2001' ? ISSUE_FILES : []);
      case '/timeline/project/10':
        return paged(TIMELINE, call);
      case '/timeline/user/7':
        return paged(
          TIMELINE.filter((e) => e.data.user.name === 'Kiet'),
          call,
        );
      case '/timeline/user/8':
        return paged(
          TIMELINE.filter((e) => e.data.user.name === 'Linh Tran'),
          call,
        );
      case '/milestones/101':
        return json(SPRINTS[1]);
      case '/milestones/101/stats':
        return json(SPRINT_7_STATS);
      case '/milestones/102':
        return json(SPRINTS[0]);
      case '/milestones/102/stats':
        return json({ total_tasks: 0, completed_tasks: 0, total_points: {}, completed_points: [], days: [] });
      case '/epics/attachments':
      case '/tasks/attachments':
        return json([]);
      case '/wiki':
        return paged(WIKI_PAGES, call);
      case '/wiki-links':
        return json(WIKI_LINKS);
      case '/wiki/by_slug': {
        const page = WIKI_PAGES.find((candidate) => candidate.slug === query['slug']);
        return page ? json(page) : notFound();
      }
      case '/search':
        return json({ count: 1, wikipages: [{ id: 1, slug: 'release-steps' }], userstories: [], tasks: [] });
      case '/resolver': {
        const kinds: Record<string, object> = {
          '42': { us: 1002 },
          '57': { issue: 2001 },
          '12': { epic: 3001 },
          '70': { task: 4001 },
        };
        return json({ project: PROJECT.id, ...kinds[query['ref'] ?? ''] });
      }
      case '/userstories/1002':
        return json(STORY_DETAIL);
      case '/issues/2001':
        return json(ISSUE_DETAIL);
      case '/epics/3001':
        return json(EPIC_DETAIL);
      case '/tasks/4001':
        return json(TASK_DETAIL);
      case '/epics/custom-attributes-values/3001':
        return json({ attributes_values: { '61': '2026-01-05', '62': '2026-02-27', '63': '' }, version: 3 });
      case '/history/userstory/1002':
        return paged(query['type'] === 'activity' ? STORY_CHANGES : STORY_COMMENTS, call);
      case '/history/issue/2001':
      case '/history/epic/3001':
      case '/history/task/4001':
        return paged([], call);
      default:
        {
          const file = FILES[path];
          if (file !== undefined) {
            return new Response(file.body, {
              headers: {
                'Content-Type': file.type,
                'Content-Length': String(file.length ?? file.body.byteLength),
              },
            });
          }
        }
        // Anything else is not there.
        return notFound();
    }
  });
}

/** A client signed in to the fake, with the clock under the test's control. */
export function acmeClient(override?: (call: Call) => Response | undefined) {
  const taiga = acme(override);
  const clock = { now: TODAY };
  const client = new TaigaClient({ baseUrl: BASE, token: 't' }, taiga.fetch, () => clock.now);
  /** The queries sent to one path, in order. */
  const queries = (path: string) => taiga.calls.filter((c) => c.path === path).map((c) => c.query);
  return { client, calls: taiga.calls, queries, clock };
}
