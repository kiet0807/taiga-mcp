import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { failure, plural, text } from '../format.js';
import type { TaigaClient } from '../taiga/client.js';

export function registerListProjects(server: McpServer, taiga: TaigaClient): void {
  server.registerTool(
    'list_projects',
    {
      title: 'List Taiga projects',
      description:
        'List the Taiga projects the signed-in user is a member of, with the name and slug of each. ' +
        'Call this first when the user names a project loosely or you do not know its slug: ' +
        'every other tool takes the slug as `project`.',
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const projects = await taiga.listProjects();
        if (projects.length === 0) return text('The signed-in user is not a member of any Taiga project.');
        const lines = projects.map(
          (project) => `- ${project.name} (slug: ${project.slug})${project.isPrivate ? '' : ' · public'}`,
        );
        return text(`${plural(projects.length, 'project')}:\n${lines.join('\n')}`);
      } catch (error) {
        return failure(error);
      }
    },
  );
}
