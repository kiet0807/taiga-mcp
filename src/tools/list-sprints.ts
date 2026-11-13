import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { answer, list } from '../format.js';
import type { TaigaClient } from '../taiga/client.js';
import { limit, project, READ_ONLY } from './shared.js';

export function registerListSprints(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'list_sprints',
    {
      title: 'List sprints',
      description:
        'List the sprints of a Taiga project (Taiga also calls them milestones), newest first: name, dates, ' +
        'how many of its stories are done, points done out of the total when the team estimates, and which ' +
        'sprint is running today. Open sprints by default; some teams never close sprints, so an old sprint ' +
        'can still be open with unfinished stories. Use it for sprint dates and progress, or to find a sprint name; ' +
        'for the stories inside a sprint call list_user_stories with `sprint`.',
      inputSchema: {
        project,
        closed: z
          .boolean()
          .optional()
          .describe('true: list finished sprints instead of open ones. Default false.'),
        limit,
      },
      annotations: READ_ONLY,
    },
    answer(async (args) => {
      const sprints = await taiga.listSprints(args.project, args);
      return list({
        scope: [sprints.project, args.closed ? 'closed sprints' : 'open sprints'],
        noun: ['sprint', 'sprints'],
        total: sprints.total,
        lines: sprints.items.map((sprint) =>
          [
            `- ${sprint.name}`,
            `${sprint.start} to ${sprint.finish}`,
            sprint.current && 'running today',
            sprint.stories === 0
              ? 'no stories'
              : `${sprint.storiesDone} of ${sprint.stories} ${sprint.stories === 1 ? 'story' : 'stories'} done`,
            // Teams that do not estimate have 0 points everywhere; "0 of 0 points" only adds noise.
            sprint.totalPoints > 0 && `${sprint.closedPoints} of ${sprint.totalPoints} points done`,
          ]
            .filter(Boolean)
            .join(' · '),
        ),
      });
    }),
  );
}
