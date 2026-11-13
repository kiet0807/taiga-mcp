import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { answer, assignee, status, truncate } from '../format.js';
import type { TaigaClient } from '../taiga/client.js';
import type { ItemDetail, ItemKind } from '../taiga/types.js';
import { project, READ_ONLY } from './shared.js';

const KIND: Record<ItemKind, string> = { story: 'User story', issue: 'Issue', epic: 'Epic' };

/** Enough for a real description; a pasted log or stack trace is cut. */
const DESCRIPTION_MAX = 4000;
const COMMENT_MAX = 600;

export function registerGetItem(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'get_item',
    {
      title: 'Read one story, issue or epic',
      description:
        'Read one user story, issue or epic of a Taiga project in full, by its reference number (the #123 ' +
        'shown in Taiga and by the list tools): status, assignee, description, custom fields and the latest ' +
        'comments. A project numbers stories, issues and epics from one sequence, so the number alone is ' +
        'enough and you need not know which kind it is. Use it after a list tool, or when the user names ' +
        'an item by number. To find items by other properties use the list tools.',
      inputSchema: {
        project,
        ref: z.number().int().positive().describe('Reference number without the #, e.g. 123.'),
      },
      annotations: READ_ONLY,
    },
    answer(async (args) => describe(await taiga.getItem(args.project, args.ref))),
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
  return sections.join('\n\n');
}
