import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { answer } from '../format.js';
import type { TaigaClient } from '../taiga/client.js';
import { TaigaError } from '../taiga/http.js';
import { assignee, ONLY_WHEN_ASKED, OVERWRITES, project, ref, subject, tags } from './shared.js';
import { written } from './written.js';

const name = (what: string) => z.string().min(1).max(200).optional().describe(what);

export function registerUpdateItem(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'update_item',
    {
      title: 'Change a story, issue, epic or task',
      description:
        'Change fields of one user story, issue, epic or task of a Taiga project, by its reference ' +
        'number, as the signed-in user: title, description, status, who it is assigned to, sprint, ' +
        'tags, due date, blocked, and for an issue its type, severity and priority. Only the fields ' +
        `given are touched. ${ONLY_WHEN_ASKED} Unless the user asked for exactly this change, say ` +
        'what will change first. To close an item, set a closed status (get_project lists them). ' +
        'Read the item with get_item first and pass its `version`: if someone changed the same ' +
        'fields since, Taiga refuses and nothing is overwritten. The answer lists every field ' +
        'before and after.',
      inputSchema: {
        project,
        ref,
        version: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe(
            'The version get_item showed for the item. Left out: the current one, so a change made by someone else in the meantime is not noticed.',
          ),
        subject: subject.optional().describe('New title.'),
        description: z
          .string()
          .max(50_000)
          .optional()
          .describe(
            'The whole new description: it replaces the old one. Start from the full text get_item showed and send all of it, changed where needed.',
          ),
        status: name('New status name (get_project lists them). A closed status closes the item.'),
        assigned_to: assignee(
          'New assignee: a member’s full name or username (part of it is enough when it fits one member), "me", or "unassigned". For a user story this person becomes the only assignee.',
        ),
        sprint: name(
          'Sprint name, "current" for the one running today, or "backlog" for none. Not for epics.',
        ),
        add_tags: tags('Tags to add, e.g. ["urgent"]. The other tags stay.'),
        remove_tags: tags('Tags to take off. The other tags stay.'),
        due_date: z
          .string()
          .regex(/^(\d{4}-\d{2}-\d{2}|none)$/, 'Use YYYY-MM-DD, or "none"')
          .optional()
          .describe('New due date as YYYY-MM-DD, or "none" to clear it. Not for epics.'),
        blocked: z.boolean().optional().describe('true: mark the item blocked. false: no longer blocked.'),
        blocked_note: z.string().max(1000).optional().describe('Why it is blocked, shown in Taiga.'),
        type: name('For an issue: new type, e.g. "Bug".'),
        severity: name('For an issue: new severity.'),
        priority: name('For an issue: new priority.'),
      },
      annotations: OVERWRITES,
    },
    answer(async (args) => {
      const { project: slug, ref: number, due_date: due, ...rest } = args;
      const fields = Object.keys(rest).filter(
        (key) => key !== 'version' && rest[key as keyof typeof rest] !== undefined,
      );
      if (fields.length === 0 && due === undefined) {
        throw new TaigaError('Nothing to change: pass at least one field, e.g. `status`.');
      }
      return written(
        'Changed',
        await taiga.updateItem(slug, number, {
          version: args.version,
          subject: args.subject,
          description: args.description,
          status: args.status,
          assignedTo: args.assigned_to,
          sprint: args.sprint,
          addTags: args.add_tags,
          removeTags: args.remove_tags,
          dueDate: due === undefined ? undefined : due === 'none' ? null : due,
          blocked: args.blocked,
          blockedNote: args.blocked_note,
          type: args.type,
          severity: args.severity,
          priority: args.priority,
        }),
      );
    }),
  );
}
