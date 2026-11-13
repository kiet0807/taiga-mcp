import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { answer, assignee, closedScope, line, list, status } from '../format.js';
import type { TaigaClient } from '../taiga/client.js';
import { assignedToMe, closed, limit, project, READ_ONLY, statusName } from './shared.js';

export function registerListUserStories(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'list_user_stories',
    {
      title: 'List user stories',
      description:
        'List user stories of a Taiga project in board order: reference number, title, status, assignee, ' +
        'points and sprint. Filter by sprint, status, open or closed, or the signed-in user. ' +
        'Use it for questions such as "what is left in the current sprint" (sprint: "current", closed: false) ' +
        'or "what is in the backlog". Bugs and requests are issues: use list_issues. ' +
        'For the description and comments of one story use get_item.',
      inputSchema: {
        project,
        sprint: z
          .string()
          .min(1)
          .optional()
          .describe(
            'A sprint name from list_sprints, or "current" for the sprint running today, or "backlog" for ' +
              'stories in no sprint. Leave out for stories of every sprint and the backlog.',
          ),
        status: statusName('In progress'),
        closed,
        assigned_to_me: assignedToMe,
        limit,
      },
      annotations: READ_ONLY,
    },
    answer(async (args) => {
      const stories = await taiga.listUserStories(args.project, {
        sprint: args.sprint,
        status: args.status,
        closed: args.closed,
        assignedToMe: args.assigned_to_me,
        limit: args.limit,
      });
      return list({
        scope: [
          stories.project,
          stories.sprint,
          args.status && `status "${args.status}"`,
          closedScope(args.closed),
          args.assigned_to_me ? 'assigned to me' : undefined,
        ],
        noun: ['user story', 'user stories'],
        total: stories.total,
        lines: stories.items.map((story) =>
          line(
            story.ref,
            story.subject,
            status(story),
            assignee(story.assignee),
            story.points === undefined ? 'no points' : `${story.points} pts`,
            // The heading already names the sprint when the list is of one sprint.
            stories.sprint === undefined && (story.sprint ?? 'backlog'),
            story.blocked && 'BLOCKED',
          ),
        ),
      });
    }),
  );
}
