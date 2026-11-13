import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { answer, dateScope } from '../format.js';
import type { TaigaClient } from '../taiga/client.js';
import { project, READ_ONLY } from './shared.js';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

const day = (what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .describe(what);

export function registerListActivity(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'list_activity',
    {
      title: 'List recent activity',
      description:
        'What happened in a Taiga project, newest first: who created, changed, commented on or deleted ' +
        'which story, task, issue, epic, wiki page or sprint, and what changed (status, assignee, sprint…). ' +
        'Use it for "what did the team do yesterday", "what has Linh done this week" (by: "Linh", from), ' +
        '"what changed on story 42" (ref: 42), or "the latest comments in the project" (comments_only: true). ' +
        'Taiga lists activity from the newest backwards, so give `from` when asking about a period: without ' +
        'it, the answer says how far back it looked. For the full history of one item, get_item with ' +
        '`changes` is shorter.',
      inputSchema: {
        project,
        by_me: z.boolean().optional().describe('true: only what the signed-in user did.'),
        by: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Only what this member did: full name or username, part of it when it fits one member, accents optional.',
          ),
        from: day('Only activity on or after this day, YYYY-MM-DD (UTC).'),
        to: day('Only activity on or before this day, YYYY-MM-DD (UTC).'),
        kind: z
          .enum(['story', 'task', 'issue', 'epic', 'wiki', 'sprint'])
          .optional()
          .describe('Only activity on this kind of thing. "epic" includes linking stories to epics.'),
        ref: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Only activity on this item (and, for a story, on its tasks), by reference number.'),
        comments_only: z.boolean().optional().describe('true: only events with a comment.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .default(DEFAULT_LIMIT)
          .describe(`Most events to return (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}).`),
        page: z
          .number()
          .int()
          .min(1)
          .default(1)
          .describe('Which part of the matches, from 1, with the same `limit` and filters.'),
      },
      annotations: READ_ONLY,
    },
    answer(async (args) => {
      const activity = await taiga.listActivity(args.project, {
        byMe: args.by_me,
        by: args.by,
        from: args.from,
        to: args.to,
        kind: args.kind,
        ref: args.ref,
        commentsOnly: args.comments_only,
        limit: args.limit,
        page: args.page,
      });
      const scope = [
        `Activity in ${activity.project}`,
        activity.by !== undefined && `by ${activity.by}`,
        args.kind &&
          `on ${args.kind === 'story' ? 'stories' : `${args.kind}${args.kind === 'wiki' ? '' : 's'}`}`,
        args.ref !== undefined && `on #${args.ref}`,
        args.comments_only && 'comments only',
        // `dateScope` answers false when neither day was given.
        (dateScope('', args.from, args.to) || '').trim(),
      ]
        .filter(Boolean)
        .join(' · ');
      const { items, first } = activity;
      const lines = items.map((event) => `- ${event.at} · ${event.author} · ${event.what}`);
      const range =
        items.length === 0 ? '' : ` ${first} to ${first + items.length - 1}, newest first; times in UTC`;
      const notes = [
        activity.more &&
          `More after these: call again with \`page\`: ${args.page + 1} and the same \`limit\` and filters.`,
        activity.checkedBackTo !== undefined &&
          `Looked back to ${activity.checkedBackTo} only; older activity was not checked. To reach further back, ` +
            'give `from`, `to`, `by` or `kind`, or ask for the next `page`.',
      ].filter(Boolean);
      if (items.length === 0) {
        return [`${scope}: nothing found.`, ...notes].join('\n\n');
      }
      return [`${scope} (${range.trim()}):\n${lines.join('\n')}`, ...notes].join('\n\n');
    }),
  );
}
