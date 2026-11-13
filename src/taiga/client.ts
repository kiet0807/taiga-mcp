import type { TaigaConfig } from '../config.js';
import { progress } from '../format.js';
import { TaigaError, TaigaHttp, type Query } from './http.js';
import type {
  Comment,
  EpicSummary,
  IssueSummary,
  ItemDetail,
  ItemKind,
  Listing,
  Named,
  Project,
  ProjectSummary,
  RawCustomValues,
  RawEpic,
  RawHistoryEntry,
  RawIssue,
  RawProject,
  RawProjectDetail,
  RawResolved,
  RawSprint,
  RawStory,
  RawTag,
  RawUser,
  SprintSummary,
  StorySummary,
} from './types.js';

export { TaigaError } from './http.js';

/** Filters arrive straight from tool arguments, where "not given" is `undefined`. */
interface ListFilters {
  /** A status name, e.g. "In progress". */
  readonly status?: string | undefined;
  /** `false`: only items whose status is open. `true`: only closed ones. */
  readonly closed?: boolean | undefined;
  readonly assignedToMe?: boolean | undefined;
  readonly limit: number;
}

export interface StoryFilters extends ListFilters {
  /** A sprint name, `current`, or `backlog`. */
  readonly sprint?: string | undefined;
}

export interface IssueFilters extends ListFilters {
  readonly severity?: string | undefined;
  readonly priority?: string | undefined;
}

/** Where each kind of item lives in Taiga's API. */
const API = {
  story: { list: '/userstories', history: 'userstory', label: 'user story' },
  issue: { list: '/issues', history: 'issue', label: 'issue' },
  epic: { list: '/epics', history: 'epic', label: 'epic' },
} as const satisfies Record<ItemKind, unknown>;

/** Statuses and sprints change rarely; one question to the model often needs the project several times. */
const PROJECT_CACHE_MS = 60_000;
const COMMENTS_SHOWN = 5;

const optional = <T, R>(value: T | undefined, use: (value: T) => R): R | undefined =>
  value === undefined ? undefined : use(value);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const day = (timestamp: string | undefined) => timestamp?.slice(0, 10);

/** Today as YYYY-MM-DD in the machine's own time zone, which is how sprint dates are meant. */
function localDay(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/**
 * What the tools ask Taiga, in the tools' own terms: project slugs, status names and reference
 * numbers go in, trimmed summaries come out. Ids never leave this class.
 */
export class TaigaClient {
  readonly #http: TaigaHttp;
  readonly #now: () => Date;
  readonly #projects = new Map<string, { at: number; project: Promise<Project> }>();
  #me: RawUser | undefined;

  constructor(config: TaigaConfig, fetchImpl: typeof fetch = fetch, now: () => Date = () => new Date()) {
    this.#http = new TaigaHttp(config, fetchImpl);
    this.#now = now;
  }

  async currentUser(): Promise<RawUser> {
    this.#me ??= await this.#http.get<RawUser>('/users/me');
    return this.#me;
  }

  /** The projects the signed-in user is a member of, by name. */
  async listProjects(): Promise<ProjectSummary[]> {
    const me = await this.currentUser();
    const projects = await this.#http.get<RawProject[]>('/projects', { member: me.id }, { everything: true });
    return projects
      .map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        isPrivate: project.is_private ?? false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Sprints, newest first. Open ones unless `closed` is true. */
  async listSprints(
    slug: string,
    options: { closed?: boolean | undefined; limit: number },
  ): Promise<Listing<SprintSummary>> {
    const project = await this.#project(slug);
    const { items, total } = await this.#http.page<RawSprint>(
      '/milestones',
      { project: project.id, closed: options.closed ?? false },
      options.limit,
    );
    const today = localDay(this.#now());
    return { project: project.name, total, items: items.map((sprint) => toSprint(sprint, today)) };
  }

  /** User stories in board order. */
  async listUserStories(
    slug: string,
    filters: StoryFilters,
  ): Promise<Listing<StorySummary> & { sprint: string | undefined }> {
    const project = await this.#project(slug);
    const sprint =
      filters.sprint === undefined ? undefined : await this.#sprintFilter(project, filters.sprint);
    const { items, total } = await this.#http.page<RawStory>(
      API.story.list,
      { ...(await this.#commonFilters(project, 'story', filters)), ...sprint?.query },
      filters.limit,
    );
    return {
      project: project.name,
      sprint: sprint?.label,
      total,
      items: items.map((story) => ({
        ...toSummary(story),
        sprint: story.milestone_name ?? undefined,
        points: story.total_points ?? undefined,
      })),
    };
  }

  /** Issues, most recently created first. */
  async listIssues(slug: string, filters: IssueFilters): Promise<Listing<IssueSummary>> {
    const project = await this.#project(slug);
    const query: Query = {
      ...(await this.#commonFilters(project, 'issue', filters)),
      severity: optional(filters.severity, (name) => find(project, project.severities, name, 'severity')),
      priority: optional(filters.priority, (name) => find(project, project.priorities, name, 'priority')),
      order_by: '-created_date',
    };
    const { items, total } = await this.#http.page<RawIssue>(API.issue.list, query, filters.limit);
    return {
      project: project.name,
      total,
      items: items.map((issue) => ({ ...toSummary(issue), ...issueNames(project, issue) })),
    };
  }

  /** Epics in board order, each with how many of its stories are done. */
  async listEpics(
    slug: string,
    options: { closed?: boolean | undefined; limit: number },
  ): Promise<Listing<EpicSummary>> {
    const project = await this.#project(slug);
    const { items, total } = await this.#http.page<RawEpic>(
      API.epic.list,
      { project: project.id, status__is_closed: options.closed },
      options.limit,
    );
    return {
      project: project.name,
      total,
      items: items.map((epic) => ({
        ...toSummary(epic),
        stories: epic.user_stories_counts?.total ?? 0,
        storiesDone: epic.user_stories_counts?.progress ?? 0,
      })),
    };
  }

  /**
   * One story, issue or epic by its reference number. Taiga numbers all three from one
   * sequence per project, so the number alone says which kind it is.
   */
  async getItem(slug: string, ref: number): Promise<ItemDetail> {
    const project = await this.#project(slug);
    const resolved = await this.#http.get<RawResolved>('/resolver', { project: project.slug, ref });
    const found = (
      [
        ['story', resolved.us],
        ['issue', resolved.issue],
        ['epic', resolved.epic],
      ] as const
    ).find(([, id]) => id !== undefined);
    if (found === undefined) {
      throw new TaigaError(
        resolved.task === undefined
          ? `Project "${project.name}" has no item #${ref}. Use a list tool to find the reference number.`
          : `#${ref} in project "${project.name}" is a task. This server reads user stories, issues and epics.`,
        404,
      );
    }
    const [kind, id] = found as [ItemKind, number];
    const api = API[kind];
    const fields = project.customFields[kind];

    const [item, custom, history] = await Promise.all([
      this.#http.get<RawStory & RawIssue & RawEpic>(`${api.list}/${id}`),
      // Most projects define no custom fields: skip the request then.
      fields.length === 0
        ? undefined
        : this.#http.get<RawCustomValues>(`${api.list}/custom-attributes-values/${id}`),
      // A deleted comment stays in the history, so ask for a few more than are shown.
      this.#http.page<RawHistoryEntry>(
        `/history/${api.history}/${id}`,
        { type: 'comment' },
        COMMENTS_SHOWN * 2,
      ),
    ]);

    const deleted = history.items.filter((entry) => entry.delete_comment_date).length;
    const comments: Comment[] = history.items
      .filter((entry) => entry.comment && !entry.delete_comment_date)
      .slice(0, COMMENTS_SHOWN)
      .map((entry) => ({
        author: entry.user?.name || entry.user?.username || 'Unknown',
        date: day(entry.created_at) ?? '',
        text: entry.comment ?? '',
      }));

    return {
      ...toSummary(item),
      kind,
      project: project.name,
      description: item.description?.trim() ?? '',
      createdBy: item.owner_extra_info?.full_name_display,
      created: day(item.created_date),
      modified: day(item.modified_date),
      blockedNote: item.is_blocked ? item.blocked_note?.trim() || 'no reason given' : undefined,
      tags: (item.tags ?? []).map(tagName),
      facts: factsOf(kind, project, item),
      customFields: fields.flatMap((field) => {
        const value = custom?.attributes_values?.[String(field.id)];
        return value === undefined || value === null || value === ''
          ? []
          : [[field.name, String(value)] as const];
      }),
      comments,
      totalComments: Math.max(history.total - deleted, comments.length),
    };
  }

  /* ------------------------------ projects ------------------------------ */

  /** The project behind a slug, remembered for a minute. */
  #project(slug: string): Promise<Project> {
    const key = slug.trim().toLowerCase();
    const cached = this.#projects.get(key);
    const now = this.#now().getTime();
    if (cached !== undefined && now - cached.at < PROJECT_CACHE_MS) return cached.project;

    const project = this.#http
      .get<RawProjectDetail>('/projects/by_slug', { slug: key })
      .then(toProject, (error: unknown) => {
        this.#projects.delete(key);
        if (error instanceof TaigaError && error.status === 404) {
          throw new TaigaError(
            `No project with slug "${slug}" that the signed-in user can read. Call list_projects to see the valid slugs.`,
            404,
          );
        }
        throw error;
      });
    this.#projects.set(key, { at: now, project });
    return project;
  }

  /* ------------------------------- filters ------------------------------- */

  async #commonFilters(project: Project, kind: ItemKind, filters: ListFilters): Promise<Query> {
    return {
      project: project.id,
      status: optional(filters.status, (name) =>
        find(project, project.statuses[kind], name, `${API[kind].label} status`),
      ),
      status__is_closed: filters.closed,
      assigned_to: filters.assignedToMe ? (await this.currentUser()).id : undefined,
    };
  }

  /** Turn what the user called a sprint into Taiga's filter, and into words for the answer. */
  async #sprintFilter(project: Project, wanted: string): Promise<{ query: Query; label: string }> {
    // A sprint that really is named "Backlog" or "Current" wins over the keyword.
    const named = project.sprints.find((sprint) => same(sprint.name, wanted) || same(sprint.slug, wanted));
    if (named !== undefined) return { query: { milestone: named.id }, label: `sprint "${named.name}"` };
    if (same(wanted, 'backlog')) return { query: { milestone__isnull: true }, label: 'backlog (no sprint)' };
    if (!same(wanted, 'current')) {
      throw new TaigaError(
        `Project "${project.name}" has no sprint "${wanted}". Pass a sprint name from list_sprints, "current" or "backlog".`,
      );
    }

    const open = await this.#http.get<RawSprint[]>(
      '/milestones',
      { project: project.id, closed: false },
      { everything: true },
    );
    const today = localDay(this.#now());
    // Newest first, so with overlapping sprints the one that started last is taken.
    const running = open.find((sprint) => isRunning(sprint, today));
    if (running === undefined) {
      const others = open.map((s) => `"${s.name}" (${s.estimated_start} to ${s.estimated_finish})`);
      throw new TaigaError(
        `No sprint of project "${project.name}" is running today (${today}). ` +
          (others.length > 0
            ? `Open sprints: ${others.join(', ')}. Pass one of these names as \`sprint\`.`
            : 'It has no open sprint. Call list_sprints with closed: true to see past ones.'),
      );
    }
    return { query: { milestone: running.id }, label: `current sprint "${running.name}"` };
  }
}

/* -------------------------- raw → trimmed shapes -------------------------- */

/** The id behind a name the user said, or an error that lists the names that exist. */
function find(project: Project, options: readonly Named[], wanted: string, what: string): number {
  const match = options.find((option) => same(option.name, wanted));
  if (match !== undefined) return match.id;
  throw new TaigaError(
    `Project "${project.name}" has no ${what} "${wanted}". It has: ${options.map((o) => o.name).join(', ') || 'none'}.`,
  );
}

const nameOf = (options: readonly Named[], id: number | null | undefined) =>
  options.find((option) => option.id === id)?.name;

const named = (list: readonly Named[] | undefined): Named[] =>
  (list ?? []).map(({ id, name }) => ({ id, name }));

function toProject(raw: RawProjectDetail): Project {
  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    statuses: {
      story: named(raw.us_statuses),
      issue: named(raw.issue_statuses),
      epic: named(raw.epic_statuses),
    },
    customFields: {
      story: named(raw.userstory_custom_attributes),
      issue: named(raw.issue_custom_attributes),
      epic: named(raw.epic_custom_attributes),
    },
    severities: named(raw.severities),
    priorities: named(raw.priorities),
    issueTypes: named(raw.issue_types),
    sprints: (raw.milestones ?? []).map(({ id, name, slug }) => ({ id, name, slug })),
  };
}

const isRunning = (sprint: RawSprint, today: string) =>
  !sprint.closed && sprint.estimated_start <= today && today <= sprint.estimated_finish;

function toSprint(sprint: RawSprint, today: string): SprintSummary {
  return {
    name: sprint.name,
    start: sprint.estimated_start,
    finish: sprint.estimated_finish,
    closed: sprint.closed,
    current: isRunning(sprint, today),
    totalPoints: sprint.total_points ?? 0,
    closedPoints: sprint.closed_points ?? 0,
    stories: sprint.user_stories?.length ?? 0,
    // By status, like the `closed` filter of the list tools. A story's own `is_closed` flag also
    // turns on when all its tasks are closed, which would disagree with the status shown.
    storiesDone: sprint.user_stories?.filter((story) => story.status_extra_info?.is_closed).length ?? 0,
  };
}

function toSummary(item: RawStory | RawIssue | RawEpic) {
  return {
    ref: item.ref,
    subject: item.subject,
    status: item.status_extra_info?.name ?? 'Unknown',
    closed: item.status_extra_info?.is_closed ?? false,
    assignee: item.assigned_to_extra_info?.full_name_display,
    blocked: item.is_blocked ?? false,
  };
}

function issueNames(project: Project, issue: RawIssue) {
  return {
    type: nameOf(project.issueTypes, issue.type),
    severity: nameOf(project.severities, issue.severity),
    priority: nameOf(project.priorities, issue.priority),
  };
}

const tagName = (tag: RawTag) => (typeof tag === 'string' ? tag : tag[0]);

/** The facts that only one kind of item has, as label and value. Missing ones are left out. */
function factsOf(
  kind: ItemKind,
  project: Project,
  item: RawStory & RawIssue & RawEpic,
): (readonly [string, string])[] {
  const facts: (readonly [string, string | undefined])[] = [];
  if (kind === 'story') {
    facts.push(
      ['Sprint', item.milestone_name ?? 'none (backlog)'],
      ['Points', item.total_points == null ? undefined : String(item.total_points)],
      ['Epics', item.epics?.map((epic) => `#${epic.ref} ${epic.subject}`).join('; ') || undefined],
    );
  } else if (kind === 'issue') {
    const names = issueNames(project, item);
    facts.push(['Type', names.type], ['Severity', names.severity], ['Priority', names.priority]);
  } else {
    const counts = item.user_stories_counts;
    facts.push(['Stories', counts ? progress(counts.progress, counts.total) : undefined]);
  }
  return facts.filter((fact): fact is readonly [string, string] => fact[1] !== undefined);
}
