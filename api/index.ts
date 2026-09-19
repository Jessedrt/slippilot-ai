import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApplication } from '../src/app.js';

const { appPromise, logger, webhookRegistrationPromise } = createApplication();

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const app = await appPromise;
  await app.ready();
  // Vercel may freeze a serverless function after its response. Finish the
  // production webhook repair while this first invocation is still running.
  // Registration errors are logged and resolved to false by createApplication.
  const registered = await webhookRegistrationPromise;
  if (!registered) logger.debug('Telegram webhook was not registered on this invocation');
  app.server.emit('request', request, response);
}
