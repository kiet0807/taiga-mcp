import express from 'express';
import { createApp } from './src/remote/app.js';
import { loadRemoteConfig } from './src/remote/config.js';

// Entry point for hosts that run an Express app as a function (Vercel finds this file by its
// name and its default export). Everywhere else, the hosted server starts from src/remote.ts.
const app: express.Express = createApp(loadRemoteConfig());

export default app;
