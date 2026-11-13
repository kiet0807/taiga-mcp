#!/usr/bin/env node
import { ConfigError } from './config.js';
import { createApp } from './remote/app.js';
import { loadRemoteConfig } from './remote/config.js';
import { SERVER_INFO } from './server.js';

// The hosted server: the same tools over HTTP, each person signing in with their own Taiga account.
try {
  const config = loadRemoteConfig();
  const app = createApp(config);
  app.listen(config.port, () => {
    console.error(
      `${SERVER_INFO.name} ${SERVER_INFO.version} listening on port ${config.port} ` +
        `(${config.anyTaiga ? 'any Taiga a person names' : `Taiga at ${config.taigaUrl}`}; ` +
        `${config.allowWrites ? 'changes offered at sign-in' : 'read-only'}; ` +
        `connect apps to ${new URL('/mcp', config.publicUrl).href})`,
    );
  });
} catch (error) {
  console.error(
    error instanceof ConfigError
      ? `taiga-mcp: ${error.message}`
      : `taiga-mcp failed to start: ${String(error)}`,
  );
  process.exit(1);
}
