/**
 * Taiga's API returns large objects. Only the fields this server reads are declared here
 * ("Raw…"), and tools hand the model the trimmed shapes below them, never the raw response.
 */

/* ------------------------------ what Taiga sends ------------------------------ */

export interface RawAuth {
  readonly auth_token: string;
  readonly refresh: string;
}

export interface RawUser {
  readonly id: number;
  readonly username: string;
  readonly full_name: string;
}

export interface RawProject {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly description?: string;
  readonly is_private?: boolean;
}

interface RawNamed {
  readonly id: number;
  readonly name: string;
  /** On statuses: items in this status count as done. */
  readonly is_closed?: boolean;
}

/** `GET /projects/by_slug`: the project together with the names its items refer to by id. */
export interface RawProjectDetail extends RawProject {
  readonly us_statuses?: readonly RawNamed[];
  readonly issue_statuses?: readonly RawNamed[];
  readonly epic_statuses?: readonly RawNamed[];
  readonly task_statuses?: readonly RawNamed[];
  readonly severities?: readonly RawNamed[];
  readonly priorities?: readonly RawNamed[];
  readonly issue_types?: readonly RawNamed[];
  readonly milestones?: readonly (RawNamed & { readonly slug: string; readonly closed: boolean })[];
  readonly userstory_custom_attributes?: readonly RawNamed[];
  readonly issue_custom_attributes?: readonly RawNamed[];
  readonly epic_custom_attributes?: readonly RawNamed[];
  readonly task_custom_attributes?: readonly RawNamed[];
  readonly members?: readonly {
    readonly id: number;
    readonly username: string;
    readonly full_name_display?: string;
    readonly full_name?: string;
    readonly role_name?: string;
  }[];
  /** The tags used on items of the project, each with its colour. */
  readonly tags_colors?: Readonly<Record<string, string | null>> | null;
  readonly is_backlog_activated?: boolean;
  readonly is_kanban_activated?: boolean;
  readonly is_issues_activated?: boolean;
  readonly is_epics_activated?: boolean;
  readonly is_wiki_activated?: boolean;
}

export interface RawSprint {
  readonly id: number;
  readonly name: string;
  readonly estimated_start: string;
  readonly estimated_finish: string;
  readonly closed: boolean;
  readonly total_points: number | null;
  readonly closed_points: number | null;
  readonly user_stories?: readonly {
    readonly status_extra_info?: { readonly is_closed?: boolean } | null;
  }[];
}

/** `GET /milestones/{id}/stats`: progress, and the burndown day by day. */
export interface RawSprintStats {
  readonly total_tasks?: number | null;
  readonly completed_tasks?: number | null;
  /** Points per role, or one number. */
  readonly total_points?: Readonly<Record<string, number | null>> | number | null;
  readonly completed_points?: readonly (number | null)[] | number | null;
  readonly iocaine_doses?: number | null;
  readonly days?: readonly {
    readonly day: string;
    readonly open_points?: number | null;
    readonly optimal_points?: number | null;
  }[];
}

/** One event of a project's activity, from `/timeline`. */
export interface RawTimelineEvent {
  readonly created: string;
  /** `<app>.<model>.<action>`, e.g. `userstories.userstory.change` or `tasks.task.create`. */
  readonly event_type: string;
  readonly data?: {
    readonly user?: { readonly name?: string; readonly username?: string } | null;
    readonly project?: { readonly id: number } | null;
    readonly comment?: string | null;
    readonly values_diff?: Readonly<Record<string, unknown>> | null;
    readonly [model: string]: unknown;
  } | null;
}

/** A tag arrives as a name, or as a `[name, colour]` pair. */
export type RawTag = string | readonly [string, string | null];

/** Fields that stories, issues and epics have in common. */
interface RawItem {
  readonly id: number;
  readonly ref: number;
  readonly subject: string;
  readonly status_extra_info?: { readonly name: string; readonly is_closed: boolean } | null;
  readonly assigned_to_extra_info?: { readonly full_name_display: string } | null;
  readonly owner_extra_info?: { readonly full_name_display: string } | null;
  readonly is_blocked?: boolean;
  readonly blocked_note?: string;
  readonly created_date?: string;
  readonly modified_date?: string;
  readonly tags?: readonly RawTag[] | null;
  readonly due_date?: string | null;
  /** Ids of the members who follow the item. */
  readonly watchers?: readonly number[] | null;
  readonly total_voters?: number | null;
  /** Only when a single item is read. */
  readonly description?: string;
}

export interface RawStory extends RawItem {
  /** When the story was closed. */
  readonly finish_date?: string | null;
  readonly milestone_name?: string | null;
  readonly total_points?: number | null;
  readonly epics?: readonly { readonly ref: number; readonly subject: string }[] | null;
}

export interface RawIssue extends RawItem {
  /** When the issue was closed. */
  readonly finished_date?: string | null;
  readonly severity?: number | null;
  readonly priority?: number | null;
  readonly type?: number | null;
}

export interface RawEpic extends RawItem {
  /** `progress` is the number of stories done; it can be fractional. */
  readonly user_stories_counts?: { readonly total: number; readonly progress: number } | null;
}

export interface RawTask extends RawItem {
  /** The story the task belongs to. A task can also stand alone in a sprint. */
  readonly user_story_extra_info?: { readonly ref: number; readonly subject: string } | null;
  /** Id of the sprint. */
  readonly milestone?: number | null;
  /** When the task was closed. */
  readonly finished_date?: string | null;
}

/** `GET /resolver`: which kind of item a reference number belongs to, and its id. */
export interface RawResolved {
  readonly us?: number;
  readonly issue?: number;
  readonly epic?: number;
  readonly task?: number;
}

export interface RawCustomValues {
  readonly attributes_values?: Readonly<Record<string, unknown>>;
}

export interface RawHistoryEntry {
  readonly user?: { readonly name?: string; readonly username?: string } | null;
  readonly created_at: string;
  readonly comment?: string;
  readonly delete_comment_date?: string | null;
  /** What changed, per field: `[before, after]`, or one level deeper for points per role. */
  readonly values_diff?: Readonly<Record<string, unknown>> | null;
}

export interface RawAttachment {
  readonly name: string;
  /** Bytes. */
  readonly size?: number | null;
  readonly url?: string | null;
  readonly description?: string | null;
  readonly is_deprecated?: boolean;
  /** Checksum of the content: the same file has the same sha1 wherever it is attached. */
  readonly sha1?: string | null;
}

export interface RawWikiPage {
  readonly slug: string;
  readonly content?: string | null;
  readonly created_date?: string;
  readonly modified_date?: string;
  /** How many times the page was saved. */
  readonly editions?: number;
  /** Id of the member who saved it last. */
  readonly last_modifier?: number | null;
}

/** An entry of the wiki's side menu: the title people see for a page. */
export interface RawWikiLink {
  readonly title: string;
  /** The slug of the page. */
  readonly href: string;
}

/** `GET /search`: matches of every kind. Only the wiki pages are read from it. */
export interface RawSearch {
  readonly wikipages?: readonly { readonly slug: string }[];
}

/* --------------------------- what tools work with --------------------------- */

export interface ProjectSummary {
  readonly id: number;
  readonly name: string;
  /** What the other tools take as `project`. */
  readonly slug: string;
  readonly isPrivate: boolean;
}

export interface Named {
  readonly id: number;
  readonly name: string;
  /** On statuses: items in this status count as done. */
  readonly closed?: boolean;
}

export type ItemKind = 'story' | 'issue' | 'epic' | 'task';

/** Someone who can be assigned work in a project. */
export interface Member {
  readonly id: number;
  /** Full name as Taiga shows it. */
  readonly name: string;
  readonly username: string;
  /** Role in the project, e.g. "Back" or "Product Owner". */
  readonly role: string | undefined;
}

/** A project and the names needed to turn "In progress" into an id, and an id back into a name. */
export interface Project {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly statuses: Readonly<Record<ItemKind, readonly Named[]>>;
  readonly customFields: Readonly<Record<ItemKind, readonly Named[]>>;
  readonly severities: readonly Named[];
  readonly priorities: readonly Named[];
  readonly issueTypes: readonly Named[];
  readonly sprints: readonly (Named & { readonly slug: string })[];
  readonly members: readonly Member[];
  readonly description: string;
  readonly isPrivate: boolean;
  /** The tags used on items of the project. */
  readonly tags: readonly string[];
  /** The parts of Taiga the project has switched on: backlog, kanban, issues, epics, wiki. */
  readonly modules: readonly string[];
}

/** One page of a list, with what the heading of the answer needs. */
export interface Listing<T> {
  readonly project: string;
  readonly items: readonly T[];
  /** How many items match, including those on other pages. */
  readonly total: number;
  /** Whose items were asked for, in words: a member's full name, "me", or "nobody". */
  readonly assignee?: string | undefined;
}

export interface SprintSummary {
  readonly name: string;
  /** Dates as YYYY-MM-DD. */
  readonly start: string;
  readonly finish: string;
  readonly closed: boolean;
  /** Today falls between `start` and `finish` and the sprint is open. */
  readonly current: boolean;
  readonly totalPoints: number;
  readonly closedPoints: number;
  readonly stories: number;
  readonly storiesDone: number;
}

interface ItemSummary {
  readonly ref: number;
  readonly subject: string;
  readonly status: string;
  readonly closed: boolean;
  readonly assignee: string | undefined;
  readonly blocked: boolean;
}

export interface StorySummary extends ItemSummary {
  readonly sprint: string | undefined;
  readonly points: number | undefined;
  /** The day it was closed, YYYY-MM-DD. */
  readonly finished: string | undefined;
}

export interface IssueSummary extends ItemSummary {
  readonly finished: string | undefined;
  readonly type: string | undefined;
  readonly severity: string | undefined;
  readonly priority: string | undefined;
}

export interface EpicSummary extends ItemSummary {
  readonly stories: number;
  /** Stories done, as Taiga counts them (can be fractional). */
  readonly storiesDone: number;
}

export interface TaskSummary extends ItemSummary {
  /** Reference number of the story the task belongs to. */
  readonly story: number | undefined;
  readonly sprint: string | undefined;
  readonly finished: string | undefined;
}

export interface Attachment {
  /** Its place in the item's list, from 1: what get_attachment takes. */
  readonly number: number;
  readonly name: string;
  /** Bytes. */
  readonly size: number | undefined;
  readonly url: string | undefined;
  readonly note: string | undefined;
  /** Checksum of the content, for remembering a file already read. */
  readonly sha1: string | undefined;
}

/** One entry of an item's history: who changed what, in words. */
export interface Change {
  readonly author: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly what: string;
}

export interface Comment {
  readonly author: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly text: string;
}

/** One story, issue, epic or task in full. */
export interface ItemDetail extends ItemSummary {
  readonly kind: ItemKind;
  readonly project: string;
  readonly description: string;
  readonly createdBy: string | undefined;
  readonly created: string | undefined;
  readonly modified: string | undefined;
  readonly blockedNote: string | undefined;
  readonly tags: readonly string[];
  /** Kind-specific facts, already as label and value: sprint, points, severity, progress… */
  readonly facts: readonly (readonly [label: string, value: string])[];
  readonly customFields: readonly (readonly [name: string, value: string])[];
  /** Newest first. Undefined when no comments were asked for. */
  readonly comments: readonly Comment[] | undefined;
  readonly totalComments: number;
  /** Of a user story: all its tasks. */
  readonly tasks: readonly TaskSummary[] | undefined;
  readonly attachments: readonly Attachment[];
  /** Newest first. Only when the history was asked for. */
  readonly changes: readonly Change[] | undefined;
  /** Entries in the whole history, including those that change nothing worth telling. */
  readonly totalChanges: number;
  /** Which page of the history `changes` is, and how many pages there are. */
  readonly changesPage: number;
  readonly changesPages: number;
}

/** One event of a project's activity, in words. */
export interface Activity {
  /** YYYY-MM-DD HH:MM, UTC. */
  readonly at: string;
  readonly author: string;
  readonly what: string;
}

export interface ActivityListing {
  readonly project: string;
  /** Whose activity, in words: a member's full name or "me". */
  readonly by: string | undefined;
  readonly items: readonly Activity[];
  /** Position of the first item among all matches, from 1. */
  readonly first: number;
  /** More matches exist after these. */
  readonly more: boolean;
  /**
   * When the search stopped before reaching the start of the activity or `from`: the day of the
   * oldest event it looked at. Older activity was not checked.
   */
  readonly checkedBackTo: string | undefined;
  /**
   * The day of the newest event in Taiga's activity log, when it matters: the period asked for
   * starts after it, or the log has been silent for over a week. A log that stops while items
   * keep changing has stopped being written (Taiga fills it in the background).
   */
  readonly logEndsOn: string | undefined;
}

export interface SprintDetail {
  readonly project: string;
  readonly name: string;
  readonly start: string;
  readonly finish: string;
  readonly closed: boolean;
  readonly current: boolean;
  readonly stories: number;
  readonly storiesDone: number;
  readonly tasks: number;
  readonly tasksDone: number;
  readonly points: number;
  readonly pointsDone: number;
  /** Tasks the people doing them flagged as "iocaine": harder than planned, taking more than one person. */
  readonly iocaineDoses: number;
  /** Day by day, up to today: points still open, and where the ideal line is. */
  readonly burndown: readonly { readonly day: string; readonly open: number; readonly ideal: number }[];
}

/** What a project is made of: the people, and the names its items use. */
export interface ProjectOverview extends Omit<Project, 'id' | 'sprints' | 'customFields'> {
  readonly customFields: Readonly<Record<ItemKind, readonly string[]>>;
  readonly openSprints: number;
  readonly closedSprints: number;
}

export interface WikiPageSummary {
  /** What get_wiki_page takes. */
  readonly slug: string;
  /** The title in the wiki's menu, when the page is listed there. */
  readonly title: string | undefined;
  readonly modified: string | undefined;
  readonly edits: number;
  /** Characters of text. */
  readonly length: number;
}

export interface WikiPage extends WikiPageSummary {
  readonly project: string;
  readonly content: string;
  readonly created: string | undefined;
  readonly modifiedBy: string | undefined;
}
