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
}

/** `GET /projects/by_slug`: the project together with the names its items refer to by id. */
export interface RawProjectDetail extends RawProject {
  readonly us_statuses?: readonly RawNamed[];
  readonly issue_statuses?: readonly RawNamed[];
  readonly epic_statuses?: readonly RawNamed[];
  readonly severities?: readonly RawNamed[];
  readonly priorities?: readonly RawNamed[];
  readonly issue_types?: readonly RawNamed[];
  readonly milestones?: readonly (RawNamed & { readonly slug: string; readonly closed: boolean })[];
  readonly userstory_custom_attributes?: readonly RawNamed[];
  readonly issue_custom_attributes?: readonly RawNamed[];
  readonly epic_custom_attributes?: readonly RawNamed[];
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
  /** Only when a single item is read. */
  readonly description?: string;
}

export interface RawStory extends RawItem {
  readonly milestone_name?: string | null;
  readonly total_points?: number | null;
  readonly epics?: readonly { readonly ref: number; readonly subject: string }[] | null;
}

export interface RawIssue extends RawItem {
  readonly severity?: number | null;
  readonly priority?: number | null;
  readonly type?: number | null;
}

export interface RawEpic extends RawItem {
  /** `progress` is the number of stories done; it can be fractional. */
  readonly user_stories_counts?: { readonly total: number; readonly progress: number } | null;
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
}

export type ItemKind = 'story' | 'issue' | 'epic';

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
}

/** One page of a list, with what the heading of the answer needs. */
export interface Listing<T> {
  readonly project: string;
  readonly items: readonly T[];
  /** How many items match, including those beyond `items`. */
  readonly total: number;
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
}

export interface IssueSummary extends ItemSummary {
  readonly type: string | undefined;
  readonly severity: string | undefined;
  readonly priority: string | undefined;
}

export interface EpicSummary extends ItemSummary {
  readonly stories: number;
  /** Stories done, as Taiga counts them (can be fractional). */
  readonly storiesDone: number;
}

export interface Comment {
  readonly author: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly text: string;
}

/** One story, issue or epic in full. */
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
  /** Newest first. */
  readonly comments: readonly Comment[];
  readonly totalComments: number;
}
