import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { answer, assignee, closedScope, line, list, progress, status } from '../format.js';
import type { TaigaClient } from '../taiga/client.js';
import { closed, limit, project, READ_ONLY } from './shared.js';

export function registerListEpics(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'list_epics',
    {
      title: 'List epics',
      description:
        'List the epics of a Taiga project in board order: reference number, title, status, assignee, and how ' +
        'many of the user stories under each epic are done. Use it for an overview of large pieces of work ' +
        'and to see which epics are behind (closed: false, then compare progress). ' +
        'Dates kept in custom fields, the description and comments of one epic come from get_item.',
      inputSchema: { project, closed, limit },
      annotations: READ_ONLY,
    },
    answer(async (args) => {
      const epics = await taiga.listEpics(args.project, args);
      return list({
        scope: [epics.project, closedScope(args.closed)],
        noun: ['epic', 'epics'],
        total: epics.total,
        lines: epics.items.map((epic) =>
          line(
            epic.ref,
            epic.subject,
            status(epic),
            assignee(epic.assignee),
            `stories: ${progress(epic.storiesDone, epic.stories)}`,
            epic.blocked && 'BLOCKED',
          ),
        ),
      });
    }),
  );
}
