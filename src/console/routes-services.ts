/**
 * The project's long-lived services (`fw serve`, `fw watch`) and the event
 * stream every page follows.
 */
import { VERSION } from '../generated-version.js';
import type { ManagedKind, Supervisor } from './services.js';
import { json, send, sse, type Json } from './respond.js';
import type { ConsoleContext, Route } from './router.js';
import { getErrorMessage } from '../utils/error-utils.js';

/** Whether `fw serve` is running for this project: ours, or from a terminal. */
export function describeServe(supervisor: Supervisor): Json {
  const s = supervisor.view('serve');
  return {
    running: s.state === 'running' && s.pid ? { url: s.url ?? null, pid: s.pid, startedAt: s.startedAt, version: s.activity?.version ?? VERSION, install: s.activity?.install ?? '', owned: s.owned, token: s.token ?? null } : null,
    state: s.state,
    command: 'fw serve --trace',
  };
}

export function serviceRoutes(ctx: ConsoleContext): Route[] {
  const listing = () => ({ services: ctx.supervisor().list(), settings: ctx.supervisor().settings() });
  return [
    { path: '/api/serve', handle: ({ res }) => json(res, 200, describeServe(ctx.supervisor())) },
    // The project's services: what runs, its settings, start and stop, its output.
    { path: '/api/services', handle: ({ res }) => json(res, 200, listing()) },
    {
      path: /^\/api\/services\/(serve|watch)\/(start|stop|restart|settings|logs)$/, handle: async ({ req, res, q, body, match }) => {
        const kind = match[1] as ManagedKind;
        const action = match[2];
        const supervisor = ctx.supervisor();
        try {
          if (action === 'logs') {
            if (q('format') === 'json') return json(res, 200, supervisor.logs(kind));
            sse(res);
            for (const line of supervisor.logs(kind)) send(res, line);
            send(res, { synced: true });
            const off = supervisor.onLog(kind, (line) => send(res, line));
            req.on('close', off);
            return;
          }
          if (req.method !== 'POST' && req.method !== 'PUT') return json(res, 405, { error: 'POST to start, stop or restart; PUT settings' });
          const b = await body();
          if (action === 'settings') { supervisor.saveSettings(kind, b); return json(res, 200, listing()); }
          if (action === 'start') { if (Object.keys(b).length) supervisor.saveSettings(kind, b); supervisor.start(kind); }
          if (action === 'stop') await supervisor.stop(kind, typeof b.pid === 'number' ? b.pid : undefined);
          if (action === 'restart') await supervisor.restart(kind);
          return json(res, 200, listing());
        } catch (err) {
          return json(res, 400, { error: getErrorMessage(err) });
        }
      },
    },
    {
      path: '/api/events', handle: ({ req, res }) => {
        sse(res);
        ctx.followers.add(res);
        req.on('close', () => ctx.followers.delete(res));
      },
    },
  ];
}
