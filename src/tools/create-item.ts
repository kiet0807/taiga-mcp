import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { answer } from '../format.js';
import type { TaigaClient } from '../taiga/client.js';
import { ADDS, assignee, ONLY_WHEN_ASKED, project, subject, tags } from './shared.js';
import { written } from './written.js';

const name = (what: string) => z.string().min(1).max(200).optional().describe(what);

export function registerCreateItem(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'create_item',
    {
      title: 'Create a user story, task or issue',
      description:
        'Create a user story, a task or an issue in a Taiga project, as the signed-in user. ' +
        `${ONLY_WHEN_ASKED} Every name (status, person, sprint, story, epic, type…) is checked before ` +
        'anything is created: a wrong one is answered with the valid names, and nothing is created. ' +
        'The answer gives the new reference number. Call it once per item: if an answer is lost, look ' +
        'for the item with search before creating it again.',
      inputSchema: {
        project,
        kind: z
          .enum(['story', 'task', 'issue'])
          .describe(
            '"story" for a user story, "task" for a task (usually of a story), "issue" for a bug or question.',
          ),
        subject: subject.describe('Title of the new item, short and specific.'),
        description: z.string().max(50_000).optional().describe('Longer text for the item. Markdown works.'),
        status: name(
          'Status name as the project defines it for this kind of item (get_project lists them). Taiga’s default when left out.',
        ),
        assigned_to: assignee(
          'Who will do it: a member’s full name or username (part of it is enough when it fits one member; accents may be left out), or "me". Nobody when left out.',
        ),
        tags: tags('Tags to put on the item, e.g. ["backend"].'),
        sprint: name(
          'Sprint name, "current" for the one running today, or "backlog" for none. Left out: a task joins the sprint of its story, a story or issue has none.',
        ),
        story: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('For a task: reference number of the user story it belongs to.'),
        epic: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('For a user story: reference number of an epic to add it to.'),
        due_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
          .optional()
          .describe('Due date as YYYY-MM-DD.'),
        type: name('For an issue: its type, e.g. "Bug". get_project lists the types.'),
        severity: name('For an issue: its severity, e.g. "Critical".'),
        priority: name('For an issue: its priority, e.g. "High".'),
      },
      annotations: ADDS,
    },
    answer(async (args) =>
      written(
        'Created',
        await taiga.createItem(args.project, {
          kind: args.kind,
          subject: args.subject,
          description: args.description,
          status: args.status,
          assignedTo: args.assigned_to,
          tags: args.tags,
          sprint: args.sprint,
          story: args.story,
          epic: args.epic,
          dueDate: args.due_date,
          type: args.type,
          severity: args.severity,
          priority: args.priority,
        }),
      ),
    ),
  );
}
