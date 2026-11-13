import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { answer, assignee, fileSize, line, status, truncate } from '../format.js';
import type { TaigaClient } from '../taiga/client.js';
import type { ItemDetail, ItemKind } from '../taiga/types.js';
import { project, READ_ONLY } from './shared.js';

const KIND: Record<ItemKind, string> = { story: 'User story', issue: 'Issue', epic: 'Epic', task: 'Task' };

/** Enough for a real description; a pasted log or stack trace is cut. */
const DESCRIPTION_MAX = 4000;
const COMMENT_MAX = 600;
const COMMENTS_DEFAULT = 5;
const COMMENTS_MAX = 50;

export function registerGetItem(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'get_item',
    {
      title: 'Read one story, issue, epic or task',
      description:
        'Read one user story, issue, epic or task of a Taiga project in full, by its reference number (the ' +
        '#123 shown in Taiga and by the list tools): status, assignee, dates, description, custom fields, ' +
        'attached files, the latest comments, and for a user story its tasks. With `changes` also who ' +
        'changed what and when (status, assignee, sprint…). A project numbers stories, issues, epics and ' +
        'tasks from one sequence, so the number alone is enough and you need not know which kind it is. ' +
        'Use it after a list tool, or when the user names an item by number. To find items by words or ' +
        'other properties use the list tools or search.',
      inputSchema: {
        project,
        ref: z.number().int().positive().describe('Reference number without the #, e.g. 123.'),
        comments: z
          .number()
          .int()
          .min(0)
          .max(COMMENTS_MAX)
          .default(COMMENTS_DEFAULT)
          .describe(
            `How many of the latest comments to read (default ${COMMENTS_DEFAULT}, at most ${COMMENTS_MAX}). ` +
              'Raise it when the answer says there are more and the discussion matters; 0 for none.',
          ),
        changes: z
          .boolean()
          .optional()
          .describe(
            'true: also list the latest changes to the item: who moved it to which status, reassigned it, ' +
              'moved it to another sprint, and when. For "when was this closed" or "who changed it".',
          ),
      },
      annotations: READ_ONLY,
    },
    answer(async (args) =>
      describe(
        await taiga.getItem(args.project, args.ref, { comments: args.comments, changes: args.changes }),
      ),
    ),
  );
}

function describe(item: ItemDetail): string {
  const facts: (readonly [string, string | undefined])[] = [
    ['Project', item.project],
    ['Status', status(item)],
    ['Assigned to', assignee(item.assignee)],
    ...item.facts,
    ['Blocked', item.blockedNote],
    ['Tags', item.tags.join(', ') || undefined],
    ['Created', item.created && `${item.created}${item.createdBy ? ` by ${item.createdBy}` : ''}`],
    ['Last changed', item.modified],
  ];
  const sections = [
    `${KIND[item.kind]} #${item.ref}: ${item.subject}`,
    facts.flatMap(([label, value]) => (value ? [`${label}: ${value}`] : [])).join('\n'),
    `Description:\n${item.description ? truncate(item.description, DESCRIPTION_MAX) : '(empty)'}`,
  ];
  if (item.customFields.length > 0) {
    sections.push(
      `Custom fields:\n${item.customFields.map(([name, value]) => `- ${name}: ${value}`).join('\n')}`,
    );
  }
  if (item.tasks !== undefined) {
    const open = item.tasks.filter((task) => !task.closed).length;
    sections.push(
      item.tasks.length === 0
        ? 'Tasks: none.'
        : `Tasks (${item.tasks.length}, ${open} still open):\n` +
            item.tasks
              .map((task) =>
                line(
                  task.ref,
                  task.subject,
                  status(task),
                  assignee(task.assignee),
                  task.blocked && 'BLOCKED',
                ),
              )
              .join('\n'),
    );
  }
  if (item.attachments.length > 0) {
    sections.push(
      `Attachments (${item.attachments.length}):\n` +
        item.attachments
          .map((file) =>
            [`- ${file.name}`, file.size !== undefined && fileSize(file.size), file.note, file.url]
              .filter(Boolean)
              .join(' · '),
          )
          .join('\n'),
    );
  }
  if (item.comments !== undefined) {
    sections.push(
      item.comments.length === 0
        ? 'Comments: none.'
        : `Comments (${
            item.comments.length < item.totalComments
              ? `latest ${item.comments.length} of ${item.totalComments}`
              : item.totalComments
          }, newest first):\n` +
            item.comments
              .map((comment) => `- ${comment.date} ${comment.author}: ${truncate(comment.text, COMMENT_MAX)}`)
              .join('\n'),
    );
  }
  if (item.changes !== undefined) {
    sections.push(
      item.changes.length === 0
        ? 'Changes: none recorded.'
        : `Changes (${
            item.changes.length < item.totalChanges
              ? `latest ${item.changes.length} of ${item.totalChanges}`
              : item.changes.length
          }, newest first):\n` +
            item.changes.map((change) => `- ${change.date} ${change.author}: ${change.what}`).join('\n'),
    );
  }
  return sections.join('\n\n');
}
