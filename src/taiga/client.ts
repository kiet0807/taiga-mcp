import type { TaigaConfig } from '../config.js';
import { progress } from '../format.js';
import { TaigaError, TaigaHttp, type Query } from './http.js';
import type {
  Attachment,
  Change,
  Comment,
  EpicSummary,
  IssueSummary,
  ItemDetail,
  ItemKind,
  Listing,
  Member,
  Named,
  Project,
  ProjectOverview,
  ProjectSummary,
  RawAttachment,
  RawCustomValues,
  RawEpic,
  RawHistoryEntry,
  RawIssue,
  RawProject,
  RawProjectDetail,
  RawResolved,
  RawSearch,
  RawSprint,
  RawStory,
  RawTag,
  RawTask,
  RawUser,
  RawWikiLink,
  RawWikiPage,
  SprintSummary,
  StorySummary,
  TaskSummary,
  WikiPage,
  WikiPageSummary,
} from './types.js';

export { TaigaError } from './http.js';

/** Which part of a long list: `limit` items a page, pages counted from 1. */
export interface Paging {
  readonly limit: number;
  readonly page?: number | undefined;
}

/** Filters arrive straight from tool arguments, where "not given" is `undefined`. */
interface ListFilters extends Paging {
  /** A status name, e.g. "In progress". */
  readonly status?: string | undefined;
  /** `false`: only items whose status is open. `true`: only closed ones. */
  readonly closed?: boolean | undefined;
  readonly assignedToMe?: boolean | undefined;
  /** A member's full name, part of it, or username; or "unassigned". */
  readonly assignedTo?: string | undefined;
  /** Words to find in the title, description and tags. */
  readonly search?: string | undefined;
  /** Only items that carry this tag. */
  readonly tag?: string | undefined;
  /** Days as YYYY-MM-DD, both included, in UTC. */
  readonly createdFrom?: string | undefined;
  readonly createdTo?: string | undefined;
  /** When the item was closed. Epics have no such date. */
  readonly finishedFrom?: string | undefined;
  readonly finishedTo?: string | undefined;
}

export interface StoryFilters extends ListFilters {
  /** A sprint name, `current`, or `backlog`. */
  readonly sprint?: string | undefined;
  /** Reference number of an epic: only the stories under it. */
  readonly epic?: number | undefined;
}

export interface IssueFilters extends ListFilters {
  /** An issue type name, e.g. "Bug". */
  readonly type?: string | undefined;
  readonly severity?: string | undefined;
  readonly priority?: string | undefined;
}

export interface TaskFilters extends ListFilters {
  /** A sprint name or `current`. */
  readonly sprint?: string | undefined;
  /** Reference number of a user story: only its tasks. */
  readonly story?: number | undefined;
}

/** Where each kind of item lives in Taiga's API, and what Taiga calls it elsewhere. */
const API = {
  story: {
    list: '/userstories',
    history: 'userstory',
    label: 'user story',
    resolved: 'us',
    finished: 'finish_date',
  },
  issue: { list: '/issues', history: 'issue', label: 'issue', resolved: 'issue', finished: 'finished_date' },
  epic: { list: '/epics', history: 'epic', label: 'epic', resolved: 'epic', finished: undefined },
  task: { list: '/tasks', history: 'task', label: 'task', resolved: 'task', finished: 'finished_date' },
} as const satisfies Record<
  ItemKind,
  {
    readonly list: string;
    readonly history: string;
    readonly label: string;
    /** The key of `/resolver`'s answer. */
    readonly resolved: keyof RawResolved;
    /** The field that holds when an item was closed. */
    readonly finished: string | undefined;
  }
>;
const KINDS = Object.keys(API) as ItemKind[];

/** What `assigned_to` may say for "assigned to nobody". */
const UNASSIGNED = new Set(['unassigned', 'nobody', 'no one', 'none']);
/** An error that lists every member is no help in a project of hundreds. */
const MEMBERS_LISTED = 40;

/** Statuses and sprints change rarely; one question to the model often needs the project several times. */
const PROJECT_CACHE_MS = 60_000;
const COMMENTS_SHOWN = 5;
const CHANGES_SHOWN = 20;
/** Fields of a history entry that say nothing a reader wants: positions on a board, and what the status already tells. */
const SILENT_CHANGES = new Set([
  'is_closed',
  'finish_date',
  'finished_date',
  'description_html',
  'blocked_note_html',
]);

const optional = <T, R>(value: T | undefined, use: (value: T) => R): R | undefined =>
  value === undefined ? undefined : use(value);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** For names of people: case and accents do not matter, so "Kiet" finds "Kiệt". */
const fold = (value: string) =>
  value.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replaceAll('đ', 'd');
/** "an issue", "an epic", but "a user story". */
const article = (label: string) => (/^[aei]/.test(label) ? `an ${label}` : `a ${label}`);
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
    options: Paging & { closed?: boolean | undefined },
  ): Promise<Listing<SprintSummary>> {
    const project = await this.#project(slug);
    const { items, total } = await this.#http.page<RawSprint>(
      '/milestones',
      { project: project.id, closed: options.closed ?? false },
      options.limit,
      options.page,
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
      filters.sprint === undefined ? undefined : await this.#sprintFilter(project, filters.sprint, 'story');
    const epic =
      filters.epic === undefined
        ? undefined
        : await this.#idOf(project, filters.epic, 'epic', 'Call list_epics for the epic numbers.');
    const common = await this.#commonFilters(project, 'story', filters);
    const { items, total } = await this.#http.page<RawStory>(
      API.story.list,
      { ...common.query, ...sprint?.query, epic },
      filters.limit,
      filters.page,
    );
    return {
      project: project.name,
      assignee: common.assignee,
      sprint: sprint?.label,
      total,
      items: items.map((story) => ({
        ...toSummary(story),
        sprint: story.milestone_name ?? undefined,
        points: story.total_points ?? undefined,
        finished: day(story.finish_date ?? undefined),
      })),
    };
  }

  /** Issues, most recently created first. */
  async listIssues(slug: string, filters: IssueFilters): Promise<Listing<IssueSummary>> {
    const project = await this.#project(slug);
    const common = await this.#commonFilters(project, 'issue', filters);
    const query: Query = {
      ...common.query,
      type: optional(filters.type, (name) => find(project, project.issueTypes, name, 'issue type')),
      severity: optional(filters.severity, (name) => find(project, project.severities, name, 'severity')),
      priority: optional(filters.priority, (name) => find(project, project.priorities, name, 'priority')),
      order_by: '-created_date',
    };
    const { items, total } = await this.#http.page<RawIssue>(
      API.issue.list,
      query,
      filters.limit,
      filters.page,
    );
    return {
      project: project.name,
      assignee: common.assignee,
      total,
      items: items.map((issue) => ({
        ...toSummary(issue),
        ...issueNames(project, issue),
        finished: day(issue.finished_date ?? undefined),
      })),
    };
  }

  /** Epics in board order, each with how many of its stories are done. */
  async listEpics(slug: string, filters: ListFilters): Promise<Listing<EpicSummary>> {
    const project = await this.#project(slug);
    const common = await this.#commonFilters(project, 'epic', filters);
    const { items, total } = await this.#http.page<RawEpic>(
      API.epic.list,
      common.query,
      filters.limit,
      filters.page,
    );
    return {
      project: project.name,
      assignee: common.assignee,
      total,
      items: items.map((epic) => ({
        ...toSummary(epic),
        stories: epic.user_stories_counts?.total ?? 0,
        storiesDone: epic.user_stories_counts?.progress ?? 0,
      })),
    };
  }

  /** Tasks, the small pieces of work inside a user story. */
  async listTasks(
    slug: string,
    filters: TaskFilters,
  ): Promise<Listing<TaskSummary> & { sprint: string | undefined }> {
    const project = await this.#project(slug);
    const sprint =
      filters.sprint === undefined ? undefined : await this.#sprintFilter(project, filters.sprint, 'task');
    const story =
      filters.story === undefined
        ? undefined
        : await this.#idOf(project, filters.story, 'story', 'Call list_user_stories for the story numbers.');
    const common = await this.#commonFilters(project, 'task', filters);
    const { items, total } = await this.#http.page<RawTask>(
      API.task.list,
      { ...common.query, ...sprint?.query, user_story: story },
      filters.limit,
      filters.page,
    );
    return {
      project: project.name,
      assignee: common.assignee,
      sprint: sprint?.label,
      total,
      items: items.map((task) => toTask(project, task)),
    };
  }

  /**
   * One story, issue, epic or task by its reference number. Taiga numbers all four from one
   * sequence per project, so the number alone says which kind it is.
   */
  async getItem(
    slug: string,
    ref: number,
    options: {
      /** How many of the latest comments to read. 0 for none. */
      comments?: number | undefined;
      /** Also read who changed what: status, assignee, sprint… */
      changes?: boolean | undefined;
    } = {},
  ): Promise<ItemDetail> {
    const project = await this.#project(slug);
    const { kind, id } = await this.#resolve(project, ref);
    if (kind === undefined) {
      throw new TaigaError(
        `Project "${project.name}" has no item #${ref}. Use a list tool to find the reference number.`,
        404,
      );
    }
    const api = API[kind];
    const fields = project.customFields[kind];
    const commentsWanted = options.comments ?? COMMENTS_SHOWN;
    const historyPath = `/history/${api.history}/${id}`;

    const [item, custom, history, activity, tasks, attachments] = await Promise.all([
      this.#http.get<RawStory & RawIssue & RawEpic & RawTask>(`${api.list}/${id}`),
      // Most projects define no custom fields: skip the request then.
      fields.length === 0
        ? undefined
        : this.#http.get<RawCustomValues>(`${api.list}/custom-attributes-values/${id}`),
      // A deleted comment stays in the history, so ask for a few more than are shown.
      commentsWanted === 0
        ? undefined
        : this.#http.page<RawHistoryEntry>(historyPath, { type: 'comment' }, commentsWanted * 2),
      options.changes
        ? this.#http.page<RawHistoryEntry>(historyPath, { type: 'activity' }, CHANGES_SHOWN)
        : undefined,
      kind === 'story'
        ? this.#http.get<RawTask[]>(
            API.task.list,
            { project: project.id, user_story: id },
            { everything: true },
          )
        : undefined,
      this.#attachments(api.list, project, id as number),
    ]);

    const deleted = history?.items.filter((entry) => entry.delete_comment_date).length ?? 0;
    const comments: Comment[] | undefined = history?.items
      .filter((entry) => entry.comment && !entry.delete_comment_date)
      .slice(0, commentsWanted)
      .map((entry) => ({
        author: authorOf(entry),
        date: day(entry.created_at) ?? '',
        text: entry.comment ?? '',
      }));
    const changes: Change[] | undefined = activity?.items.flatMap((entry) => {
      const what = describeChange(entry.values_diff ?? {});
      return what === undefined ? [] : [{ author: authorOf(entry), date: day(entry.created_at) ?? '', what }];
    });

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
      totalComments: Math.max((history?.total ?? 0) - deleted, comments?.length ?? 0),
      tasks: tasks?.map((task) => toTask(project, task)),
      attachments,
      changes,
      totalChanges: Math.max(activity?.total ?? 0, changes?.length ?? 0),
    };
  }

  /** The files attached to an item. An item the user may read but whose files they may not is shown without them. */
  async #attachments(list: string, project: Project, id: number): Promise<Attachment[]> {
    const raw = await this.#http
      .get<RawAttachment[]>(
        `${list}/attachments`,
        { project: project.id, object_id: id },
        { everything: true },
      )
      .catch((error: unknown) => {
        if (error instanceof TaigaError && (error.status === 403 || error.status === 404)) return [];
        throw error;
      });
    return raw
      .filter((file) => !file.is_deprecated)
      .map((file) => ({
        name: file.name,
        size: file.size ?? undefined,
        url: file.url ?? undefined,
        note: file.description?.trim() || undefined,
      }));
  }

  /* -------------------------------- project -------------------------------- */

  /** The people of a project and the names its items use: statuses, severities, tags… */
  async getProject(slug: string): Promise<ProjectOverview> {
    const project = await this.#project(slug);
    const { sprints, customFields } = project;
    return {
      name: project.name,
      slug: project.slug,
      description: project.description,
      isPrivate: project.isPrivate,
      modules: project.modules,
      members: project.members,
      statuses: project.statuses,
      severities: project.severities,
      priorities: project.priorities,
      issueTypes: project.issueTypes,
      tags: project.tags,
      customFields: {
        story: customFields.story.map((field) => field.name),
        issue: customFields.issue.map((field) => field.name),
        epic: customFields.epic.map((field) => field.name),
        task: customFields.task.map((field) => field.name),
      },
      openSprints: sprints.filter((sprint) => !sprint.closed).length,
      closedSprints: sprints.filter((sprint) => sprint.closed).length,
    };
  }

  /* ---------------------------------- wiki ---------------------------------- */

  /** The wiki pages of a project, most recently changed first. */
  async listWikiPages(slug: string, paging: Paging): Promise<Listing<WikiPageSummary>> {
    const project = await this.#project(slug);
    const [pages, links] = await Promise.all([
      this.#http.page<RawWikiPage>(
        '/wiki',
        { project: project.id, order_by: '-modified_date' },
        paging.limit,
        paging.page,
      ),
      this.#wikiLinks(project),
    ]);
    return {
      project: project.name,
      total: pages.total,
      items: pages.items.map((page) => toWikiSummary(page, links)),
    };
  }

  /** One wiki page, by its slug or by its title in the wiki's menu. */
  async getWikiPage(slug: string, page: string): Promise<WikiPage> {
    const project = await this.#project(slug);
    const links = await this.#wikiLinks(project);
    const wanted = links.find((link) => same(link.title, page))?.href ?? page.trim().toLowerCase();
    const raw = await this.#http
      .get<RawWikiPage>('/wiki/by_slug', { project: project.id, slug: wanted })
      .catch((error: unknown) => {
        if (error instanceof TaigaError && error.status === 404) {
          throw new TaigaError(
            `Project "${project.name}" has no wiki page "${page}". Call list_wiki_pages to see the pages.`,
            404,
          );
        }
        throw error;
      });
    return {
      ...toWikiSummary(raw, links),
      project: project.name,
      content: raw.content?.trim() ?? '',
      created: day(raw.created_date),
      modifiedBy: project.members.find((member) => member.id === raw.last_modifier)?.name,
    };
  }

  /** The wiki pages whose text contains the words. */
  async searchWiki(slug: string, words: string): Promise<WikiPageSummary[]> {
    const project = await this.#project(slug);
    const [found, links] = await Promise.all([
      this.#http.get<RawSearch>('/search', { project: project.id, text: words.trim() }),
      this.#wikiLinks(project),
    ]);
    return (found.wikipages ?? []).map((page) => toWikiSummary(page, links));
  }

  #wikiLinks(project: Project): Promise<RawWikiLink[]> {
    return this.#http.get<RawWikiLink[]>('/wiki-links', { project: project.id }, { everything: true });
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

  /** The filters every kind of item has, as Taiga's query, and whose items they select in words. */
  async #commonFilters(
    project: Project,
    kind: ItemKind,
    filters: ListFilters,
  ): Promise<{ query: Query; assignee: string | undefined }> {
    const who = await this.#assignee(project, filters);
    const finished = API[kind].finished;
    if (finished === undefined && (filters.finishedFrom ?? filters.finishedTo) !== undefined) {
      throw new TaigaError(
        `Taiga keeps no finish date for ${API[kind].label}s. Filter them with \`closed\`.`,
      );
    }
    return {
      assignee: who?.label,
      query: {
        project: project.id,
        status: optional(filters.status, (name) =>
          find(project, project.statuses[kind], name, `${API[kind].label} status`),
        ),
        status__is_closed: filters.closed,
        assigned_to: who?.value,
        q: searchWords(filters.search),
        tags: filters.tag?.trim().toLowerCase() || undefined,
        created_date__gte: filters.createdFrom,
        created_date__lte: optional(filters.createdTo, endOfDay),
        ...(finished === undefined
          ? {}
          : {
              [`${finished}__gte`]: filters.finishedFrom,
              [`${finished}__lte`]: optional(filters.finishedTo, endOfDay),
            }),
      },
    };
  }

  async #assignee(
    project: Project,
    filters: ListFilters,
  ): Promise<{ value: number | 'null'; label: string } | undefined> {
    if (filters.assignedTo === undefined) {
      return filters.assignedToMe ? { value: (await this.currentUser()).id, label: 'me' } : undefined;
    }
    if (filters.assignedToMe) {
      throw new TaigaError('Pass either `assigned_to_me` or `assigned_to`, not both.');
    }
    if (UNASSIGNED.has(fold(filters.assignedTo))) return { value: 'null', label: 'nobody' };
    const member = findMember(project, filters.assignedTo);
    return { value: member.id, label: member.name };
  }

  /** Which kind of item a reference number belongs to, and its id. Both missing: no such item. */
  async #resolve(project: Project, ref: number): Promise<{ kind?: ItemKind; id?: number }> {
    const resolved = await this.#http.get<RawResolved>('/resolver', { project: project.slug, ref });
    const kind = KINDS.find((candidate) => resolved[API[candidate].resolved] !== undefined);
    return kind === undefined ? {} : { kind, id: resolved[API[kind].resolved] as number };
  }

  /** The id behind a reference number that must be of one kind, e.g. the epic to filter stories by. */
  async #idOf(project: Project, ref: number, wanted: ItemKind, hint: string): Promise<number> {
    const { kind, id } = await this.#resolve(project, ref);
    if (kind === wanted && id !== undefined) return id;
    const label = API[wanted].label;
    throw new TaigaError(
      kind === undefined
        ? `Project "${project.name}" has no ${label} #${ref}. ${hint}`
        : `#${ref} in project "${project.name}" is ${article(API[kind].label)}, not ${article(label)}. ${hint}`,
      404,
    );
  }

  /** Turn what the user called a sprint into Taiga's filter, and into words for the answer. */
  async #sprintFilter(
    project: Project,
    wanted: string,
    /** Stories can be in no sprint (the backlog); Taiga cannot list tasks that way. */
    of: 'story' | 'task',
  ): Promise<{ query: Query; label: string }> {
    // A sprint that really is named "Backlog" or "Current" wins over the keyword.
    const named = project.sprints.find((sprint) => same(sprint.name, wanted) || same(sprint.slug, wanted));
    if (named !== undefined) return { query: { milestone: named.id }, label: `sprint "${named.name}"` };
    if (same(wanted, 'backlog')) {
      if (of === 'story') return { query: { milestone__isnull: true }, label: 'backlog (no sprint)' };
      throw new TaigaError(
        'Tasks cannot be listed by backlog. List the backlog stories with list_user_stories (sprint: "backlog"), then the tasks of one story with `story`.',
      );
    }
    if (!same(wanted, 'current')) {
      throw new TaigaError(
        `Project "${project.name}" has no sprint "${wanted}". Pass a sprint name from list_sprints` +
          (of === 'story' ? ', "current" or "backlog".' : ' or "current".'),
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

/** The one member a name, part of a name, or a username points at; or an error that says who there is. */
function findMember(project: Project, wanted: string): Member {
  const key = fold(wanted);
  const show = (member: Member) => `${member.name} (${member.username})`;
  const exact = project.members.filter((m) => fold(m.name) === key || fold(m.username) === key);
  const matches =
    exact.length > 0
      ? exact
      : project.members.filter((m) => fold(m.name).includes(key) || fold(m.username).includes(key));
  const [only, ...others] = matches;
  if (only !== undefined && others.length === 0) return only;
  if (only === undefined) {
    const listed = project.members.slice(0, MEMBERS_LISTED).map(show).join(', ');
    const more = project.members.length - MEMBERS_LISTED;
    throw new TaigaError(
      `Project "${project.name}" has no member "${wanted}". Members: ${listed || 'none'}${more > 0 ? `, and ${more} more` : ''}.`,
    );
  }
  throw new TaigaError(
    `"${wanted}" matches several members of project "${project.name}": ${matches.map(show).join(', ')}. Pass the full name or the username.`,
  );
}

/** What Taiga's `q` filter gets: the words, or nothing when there are none. */
const searchWords = (search: string | undefined) => search?.trim() || undefined;

/** The last moment of a day, so that "to 2026-03-31" includes what happened on the 31st. */
const endOfDay = (date: string) => `${date}T23:59:59Z`;

const authorOf = (entry: RawHistoryEntry) => entry.user?.name || entry.user?.username || 'Unknown';

/** A value of a history entry, short enough for one line. */
function shown(value: unknown): string {
  if (value === null || value === undefined || value === '' || value === 'None') return 'none';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

/** What one history entry changed, in words: `status: New → In progress; assigned to: none → Linh Tran`. */
function describeChange(diff: Readonly<Record<string, unknown>>): string | undefined {
  const label = (key: string) => (key === 'milestone' ? 'sprint' : key.replaceAll('_', ' '));
  const parts: string[] = [];
  for (const [key, value] of Object.entries(diff)) {
    if (SILENT_CHANGES.has(key) || key.endsWith('_order')) continue;
    if (key.endsWith('_diff')) {
      parts.push(`${label(key.slice(0, -'_diff'.length))} edited`);
    } else if (Array.isArray(value) && value.length === 2) {
      parts.push(`${label(key)}: ${shown(value[0])} → ${shown(value[1])}`);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Points are kept per role: { "Back": ["?", "3"] }. Attachments: { new: [...], deleted: [...] }.
      const inner = Object.entries(value).flatMap(([name, pair]) =>
        Array.isArray(pair) && pair.length === 2 && !Array.isArray(pair[0]) && typeof pair[0] !== 'object'
          ? [`${label(key)} (${name}): ${shown(pair[0])} → ${shown(pair[1])}`]
          : [],
      );
      parts.push(...(inner.length > 0 ? inner : [`${label(key)} changed`]));
    } else {
      parts.push(`${label(key)} changed`);
    }
  }
  return parts.length === 0 ? undefined : parts.join('; ');
}

function toTask(project: Project, task: RawTask): TaskSummary {
  return {
    ...toSummary(task),
    story: task.user_story_extra_info?.ref,
    sprint: nameOf(project.sprints, task.milestone),
    finished: day(task.finished_date ?? undefined),
  };
}

function toWikiSummary(page: RawWikiPage, links: readonly RawWikiLink[]): WikiPageSummary {
  return {
    slug: page.slug,
    title: links.find((link) => link.href === page.slug)?.title,
    modified: day(page.modified_date),
    edits: page.editions ?? 0,
    length: page.content?.length ?? 0,
  };
}

const nameOf = (options: readonly Named[], id: number | null | undefined) =>
  options.find((option) => option.id === id)?.name;

const named = (list: RawProjectDetail['severities']): Named[] =>
  (list ?? []).map(({ id, name }) => ({ id, name }));

/** Statuses also say whether they count as done. */
const statuses = (list: RawProjectDetail['us_statuses']): Named[] =>
  (list ?? []).map(({ id, name, is_closed }) => ({ id, name, closed: is_closed ?? false }));

function toProject(raw: RawProjectDetail): Project {
  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    statuses: {
      story: statuses(raw.us_statuses),
      issue: statuses(raw.issue_statuses),
      epic: statuses(raw.epic_statuses),
      task: statuses(raw.task_statuses),
    },
    customFields: {
      story: named(raw.userstory_custom_attributes),
      issue: named(raw.issue_custom_attributes),
      epic: named(raw.epic_custom_attributes),
      task: named(raw.task_custom_attributes),
    },
    severities: named(raw.severities),
    priorities: named(raw.priorities),
    issueTypes: named(raw.issue_types),
    sprints: (raw.milestones ?? []).map(({ id, name, slug, closed }) => ({ id, name, slug, closed })),
    members: (raw.members ?? []).map((member) => ({
      id: member.id,
      username: member.username,
      name: member.full_name_display || member.full_name || member.username,
      role: member.role_name || undefined,
    })),
    description: raw.description?.trim() ?? '',
    isPrivate: raw.is_private ?? false,
    tags: Object.keys(raw.tags_colors ?? {}).sort((a, b) => a.localeCompare(b)),
    modules: (
      [
        ['backlog', raw.is_backlog_activated],
        ['kanban', raw.is_kanban_activated],
        ['issues', raw.is_issues_activated],
        ['epics', raw.is_epics_activated],
        ['wiki', raw.is_wiki_activated],
      ] as const
    ).flatMap(([name, on]) => (on ? [name] : [])),
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

function toSummary(item: RawStory | RawIssue | RawEpic | RawTask) {
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
  item: RawStory & RawIssue & RawEpic & RawTask,
): (readonly [string, string])[] {
  const facts: (readonly [string, string | undefined])[] = [
    ['Due', day(item.due_date ?? undefined)],
    ['Finished', day((kind === 'story' ? item.finish_date : item.finished_date) ?? undefined)],
  ];
  if (kind === 'story') {
    facts.push(
      ['Sprint', item.milestone_name ?? 'none (backlog)'],
      ['Points', item.total_points == null ? undefined : String(item.total_points)],
      ['Epics', item.epics?.map((epic) => `#${epic.ref} ${epic.subject}`).join('; ') || undefined],
    );
  } else if (kind === 'issue') {
    const names = issueNames(project, item);
    facts.push(['Type', names.type], ['Severity', names.severity], ['Priority', names.priority]);
  } else if (kind === 'task') {
    const story = item.user_story_extra_info;
    facts.push(
      ['User story', story ? `#${story.ref} ${story.subject}` : 'none'],
      ['Sprint', nameOf(project.sprints, item.milestone)],
    );
  } else {
    const counts = item.user_stories_counts;
    facts.push(['Stories', counts ? progress(counts.progress, counts.total) : undefined]);
  }
  return facts.filter((fact): fact is readonly [string, string] => fact[1] !== undefined);
}
