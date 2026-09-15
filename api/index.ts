import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApplication } from '../src/app.js';

const { appPromise, logger, webhookRegistrationPromise } = createApplication();

void webhookRegistrationPromise.catch((error: unknown) => {
  logger.warn({ error }, 'Telegram webhook registration failed');
});

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const app = await appPromise;
  await app.ready();
  app.server.emit('request', request, response);
}
