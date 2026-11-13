#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError, loadConfig } from './config.js';
import { createServer, SERVER_INFO } from './server.js';
import { TaigaClient } from './taiga/client.js';

// stdout belongs to the MCP protocol. Everything meant for a person goes to stderr.
try {
  const config = loadConfig();
  const server = createServer(new TaigaClient(config), {
    howToAllowWrites: 'set TAIGA_WRITE=true where this server is configured, then restart it.',
  });
  await server.connect(new StdioServerTransport());
  console.error(
    `${SERVER_INFO.name} ${SERVER_INFO.version} ready (Taiga at ${config.baseUrl}; ` +
      `${config.write ? 'creating and changing items is ON' : 'read-only'})`,
  );
} catch (error) {
  console.error(
    error instanceof ConfigError
      ? `taiga-mcp: ${error.message}`
      : `taiga-mcp failed to start: ${String(error)}`,
  );
  process.exit(1);
}
