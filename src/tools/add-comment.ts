import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { answer } from '../format.js';
import type { TaigaClient } from '../taiga/client.js';
import { ADDS, ONLY_WHEN_ASKED, project, ref } from './shared.js';
import { written } from './written.js';

export function registerAddComment(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'add_comment',
    {
      title: 'Comment on a story, issue, epic or task',
      description:
        'Post a comment on one user story, issue, epic or task of a Taiga project, by its reference ' +
        'number, as the signed-in user. Project members are notified as Taiga does for any comment. ' +
        `${ONLY_WHEN_ASKED} Unless the user dictated the text word for word, show it to them first. ` +
        'Comments cannot be edited or removed from here.',
      inputSchema: {
        project,
        ref,
        text: z
          .string()
          .min(1)
          .max(10_000)
          .describe('The comment exactly as it should appear in Taiga. Markdown works.'),
      },
      annotations: ADDS,
    },
    answer(async (args) =>
      written('Commented on', await taiga.addComment(args.project, args.ref, args.text)),
    ),
  );
}
