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
 * per item, and, when the list was cut at `limit`, how many items are missing and what to do.
 */
export function list(options: {
  /** The project and the filters, e.g. `Billing · sprint "Sprint 12" · open only`. */
  readonly scope: readonly (string | undefined)[];
  readonly noun: readonly [one: string, many: string];
  readonly lines: readonly string[];
  readonly total: number;
}): string {
  const { lines, total, noun } = options;
  const scope = options.scope.filter((part) => part !== undefined).join(' · ');
  if (lines.length === 0) return `${scope}: no ${noun[1]} found.`;
  if (lines.length >= total) return `${scope}: ${plural(total, ...noun)}.\n${lines.join('\n')}`;
  return (
    `${scope}: ${plural(total, ...noun)}, the first ${lines.length} shown.\n${lines.join('\n')}\n\n` +
    `${total - lines.length} more not shown. Narrow the filters, or raise \`limit\` (at most ${MAX_LIMIT}).`
  );
}

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

/** Long text cut to `max` characters, saying how much was left out. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}… [${value.length - max} more characters not shown]`;
}
