import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { answer, plural } from '../format.js';
import type { TaigaClient } from '../taiga/client.js';
import type { SprintDetail } from '../taiga/types.js';
import { project, READ_ONLY } from './shared.js';

export function registerGetSprint(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'get_sprint',
    {
      title: 'Read one sprint',
      description:
        'Read one sprint of a Taiga project in full: dates, how many stories, tasks and points are done, ' +
        'and the burndown day by day (points still open against the ideal line), up to today. Use it for ' +
        '"how is the sprint going", "are we on track", or a sprint review. For the stories or tasks in it ' +
        'use list_user_stories or list_tasks with `sprint`.',
      inputSchema: {
        project,
        sprint: z
          .string()
          .min(1)
          .default('current')
          .describe(
            'A sprint name from list_sprints, or "current" for the sprint running today (the default).',
          ),
      },
      annotations: READ_ONLY,
    },
    answer(async (args) => describe(await taiga.getSprint(args.project, args.sprint))),
  );
}

const of = (done: number, total: number, noun: string) =>
  total === 0 ? `no ${noun}` : `${done} of ${total} ${noun} done (${Math.round((done / total) * 100)}%)`;

function describe(sprint: SprintDetail): string {
  const state = sprint.closed ? 'closed' : sprint.current ? 'open, running today' : 'open';
  const sections = [
    `Sprint "${sprint.name}" of ${sprint.project} · ${sprint.start} to ${sprint.finish} · ${state}`,
    [
      `Stories: ${of(sprint.storiesDone, sprint.stories, 'stories')}${sprint.stories > 0 ? ', counted by status' : ''}`,
      `Tasks: ${of(sprint.tasksDone, sprint.tasks, 'tasks')}`,
      sprint.points > 0
        ? `Points: ${of(sprint.pointsDone, sprint.points, 'points')}`
        : 'Points: the team did not estimate this sprint',
      sprint.iocaineDoses > 0
        ? `Tasks flagged as iocaine (harder than planned): ${sprint.iocaineDoses}`
        : undefined,
    ]
      .filter(Boolean)
      .join('\n'),
  ];
  if (sprint.burndown.length > 0) {
    const last = sprint.burndown.at(-1);
    const verdict =
      last === undefined
        ? undefined
        : last.open <= last.ideal
          ? `On ${last.day}: ${plural(last.open, 'point')} open, at or below the ideal ${last.ideal}.`
          : `On ${last.day}: ${plural(last.open, 'point')} open, ${Math.round((last.open - last.ideal) * 10) / 10} above the ideal ${last.ideal}.`;
    sections.push(
      `Burndown, points still open at the end of each day (ideal in brackets):\n` +
        sprint.burndown.map((d) => `- ${d.day}: ${d.open} (${d.ideal})`).join('\n') +
        (verdict ? `\n${verdict}` : ''),
    );
  } else if (sprint.points === 0) {
    sections.push('No burndown: Taiga draws it from points, and none were given.');
  }
  return sections.join('\n\n');
}
