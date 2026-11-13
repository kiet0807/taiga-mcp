// Vercel recognises an Express entry file by this import, so it stays although nothing here
// calls express directly.
import 'express';
import { createApp } from './dist/remote/app.js';
import { loadRemoteConfig } from './dist/remote/config.js';

// Entry point for hosts that run an Express app as a function (Vercel finds this file by its
// name, its import of express and its default export). Everywhere else, the hosted server
// starts from src/remote.ts.
//
// It is plain JavaScript and imports the compiled output on purpose: the host runs
// `pnpm build` first, so dist/ exists, and TypeScript is checked once, by this repo's own tsc.
// As a .ts file importing ./src, Vercel type-checked the sources a second time with its own
// settings and failed on code that `pnpm typecheck` accepts.
const app = createApp(loadRemoteConfig());

export default app;
