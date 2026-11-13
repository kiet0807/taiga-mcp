import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TaigaError } from './taiga/http.js';

/** A tool's answer as plain text: what the model reads. */
export function text(value: string): CallToolResult {
  return { content: [{ type: 'text', text: value }] };
}

/**
 * A failed tool call. It is returned, not thrown, and flagged `isError`, so the model sees
 * what went wrong and can try something else or tell the user.
 */
export function failure(error: unknown): CallToolResult {
  const message =
    error instanceof TaigaError
      ? error.message
      : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** Run a tool handler that answers in text; whatever it throws becomes a readable tool error. */
export function answer<Args>(
  handler: (args: Args) => Promise<string>,
): (args: Args) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return text(await handler(args));
    } catch (error) {
      return failure(error);
    }
  };
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * A list as the model reads it: a heading that repeats which filters were applied, one line
 * per item, and, when the list does not fit in one answer, which part this is and how to get
 * the rest.
 */
export function list(options: {
  /** The project and the filters, e.g. `Billing · sprint "Sprint 12" · open only`. */
  readonly scope: readonly (string | undefined | false)[];
  readonly noun: readonly [one: string, many: string];
  readonly lines: readonly string[];
  readonly total: number;
  /** The `limit` and `page` the tool was called with. */
  readonly limit: number;
  readonly page: number;
}): string {
  const { lines, total, noun, limit, page } = options;
  const scope = options.scope.filter(Boolean).join(' · ');
  if (lines.length === 0) return `${scope}: no ${noun[1]} found.`;
  if (page === 1 && lines.length >= total) return `${scope}: ${plural(total, ...noun)}.\n${lines.join('\n')}`;

  const first = (page - 1) * limit + 1;
  const last = first + lines.length - 1;
  const pages = Math.max(page, Math.ceil(total / limit));
  const heading = `${scope}: ${plural(total, ...noun)}, ${first} to ${last} shown (page ${page} of ${pages}).`;
  const rest =
    last < total
      ? `${total - last} more after these. For the next ones call again with \`page\`: ${page + 1} and the same \`limit\` and filters, or narrow the filters.`
      : 'This is the last page.';
  return `${heading}\n${lines.join('\n')}\n\n${rest}`;
}

/** "assigned to Linh Tran", for the heading of a list. */
export const assignedScope = (who: string | undefined) => who !== undefined && `assigned to ${who}`;

/** `finished 2026-03-01 to 2026-03-31`, for the heading of a list. Either end may be open. */
export function dateScope(what: string, from: string | undefined, to: string | undefined) {
  if (from !== undefined && to !== undefined) return `${what} ${from} to ${to}`;
  if (from !== undefined) return `${what} from ${from}`;
  return to !== undefined && `${what} until ${to}`;
}

/** `matching "invoice export"`, for the heading of a list. */
export const searchScope = (words: string | undefined) => !!words?.trim() && `matching "${words.trim()}"`;

export const DEFAULT_LIMIT = 30;
export const MAX_LIMIT = 100;

/** One line of a list: the parts that exist, joined. */
export function line(ref: number, subject: string, ...parts: (string | undefined | false)[]): string {
  return [`- #${ref} ${oneLine(subject)}`, ...parts.filter(Boolean)].join(' · ');
}

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Status as text, saying so when it counts as closed (names like "Ready for test" do not tell). */
export function status(item: { readonly status: string; readonly closed: boolean }): string {
  return item.closed ? `${item.status} (closed)` : item.status;
}

export const assignee = (name: string | undefined) => name ?? 'unassigned';

/** Words for the `closed` filter in a heading. */
export function closedScope(closed: boolean | undefined): string | undefined {
  return closed === undefined ? undefined : closed ? 'closed only' : 'open only';
}

/**
 * "35 stories, 34% done". Taiga counts a half-finished story as a fraction, so a count of done
 * stories ("5.5 of 21") reads oddly; a percentage of the whole does not.
 */
export function progress(done: number, total: number): string {
  if (total === 0) return 'no stories';
  return `${total} ${total === 1 ? 'story' : 'stories'}, ${Math.round((done / total) * 100)}% done`;
}

/** A file's size as people say it: "84 KB", "1.2 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Long text cut to `max` characters, saying how much was left out. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}… [${value.length - max} more characters not shown]`;
}
