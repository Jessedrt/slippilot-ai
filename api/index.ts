import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApplication } from '../src/app.js';

const { appPromise, webhookRegistrationPromise } = createApplication();

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const app = await appPromise;
  await webhookRegistrationPromise;
  await app.ready();
  app.server.emit('request', request, response);
}
