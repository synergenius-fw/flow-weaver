/**
 * Runs: listed, started (or stepped through), watched, answered, cancelled,
 * forgotten, and driven one step at a time in a debug session.
 */
import { transcriptName } from '../coordinator/index.js';
import { stamp as gitStamp } from './git.js';
import { mocksFrom } from './runs.js';
import { json, type Json } from './respond.js';
import type { Call, ConsoleContext, Route } from './router.js';
import { getErrorMessage } from '../utils/error-utils.js';

/** Moving a debug session (answered at once, the pause arrives over the stream), or changing its state (applied first). */
async function debugAction(ctx: ConsoleContext, id: string, { res, body }: Call): Promise<void> {
  const { debug } = ctx.runs;
  const d = debug.get(id);
  if (!d) return json(res, 404, { error: 'not a debug session' });
  const b = await body();
  const action = String(b.action);
  try {
    if (action === 'step' || action === 'continue' || action === 'toBreakpoint') {
      if (d.status !== 'paused') return json(res, 400, { error: `the session is ${d.status}, not paused` });
      const move = action === 'step' ? debug.step(id) : debug.continue(id, action === 'toBreakpoint');
      move.catch(() => undefined);
    } else if (action === 'abort') {
      debug.abort(id).catch(() => undefined);
    } else if (action === 'set') {
      debug.setVariable(id, String(b.node), String(b.port), b.value);
      // The spine reads values from the trace; tell it about this one.
      ctx.runs.announce(id, { type: 'event', t: Date.now(), e: { type: 'VARIABLE_SET', identifier: { id: String(b.node), portName: String(b.port) }, value: b.value } });
    } else if (action === 'breakpoint') {
      debug.breakpoint(id, b.op === 'remove' ? 'remove' : 'add', String(b.node));
    } else {
      return json(res, 400, { error: `unknown action ${action}` });
    }
    return json(res, 200, await ctx.runs.snapshot(id));
  } catch (err) {
    return json(res, 400, { error: getErrorMessage(err) });
  }
}

export function runRoutes(ctx: ConsoleContext): Route[] {
  const { runs } = ctx;
  return [
    { method: 'GET', path: '/api/runs', handle: async ({ res, q }) => json(res, 200, await runs.list(q('file'), q('name'))) },
    {
      method: 'POST', path: '/api/runs', handle: async ({ res, body }) => {
        const b = await body();
        const target = ctx.inProject(String(b.file));
        if (!target) return json(res, 400, { error: 'file is outside the project' });
        const mocks = mocksFrom(b);
        // Stamped with the commit the file stood at, and whether it had
        // uncommitted changes, so a run can later be compared with the file.
        const source = await gitStamp(target).catch(() => undefined);
        const params = (b.params as Json) ?? {};
        if (b.debug === true) {
          const bps = Array.isArray(b.breakpoints) ? (b.breakpoints as string[]).filter((x) => typeof x === 'string') : [];
          return json(res, 200, runs.startDebug(target, String(b.name), params, bps, mocks, b.runTo === 'breakpoint' ? 'breakpoint' : 'first', source));
        }
        return json(res, 200, await runs.start(target, String(b.name), params, mocks, source, b.agents === 'manual' ? 'manual' : 'auto'));
      },
    },
    {
      path: /^\/api\/runs\/([^/]+)(?:\/(events|resolve|cancel|debug|agent))?$/, handle: async (call) => {
        const { req, res, q, body, match } = call;
        const id = match[1];
        const sub = match[2];
        if (!(await runs.snapshot(id))) return json(res, 404, { error: 'no such run' });
        // Forgetting a run: only one that is over, and only from the store --
        // what is in flight is stopped first, with cancel.
        if (!sub && req.method === 'DELETE') {
          try { await runs.remove(id); } catch (err) { return json(res, 409, { error: getErrorMessage(err) }); }
          return json(res, 200, { removed: id });
        }
        if (sub === 'events') return runs.watch(id, req, res);
        if (sub === 'resolve' && req.method === 'POST') {
          try { await runs.resume(id, await body()); return json(res, 200, await runs.snapshot(id)); }
          catch (err) { return json(res, 400, { error: getErrorMessage(err) }); }
        }
        if (sub === 'agent' && req.method === 'POST') {
          const refused = await runs.askAgent(id);
          if (refused) return json(res, 409, { error: refused });
          return json(res, 200, await runs.snapshot(id));
        }
        // What the agent said and did about the run's latest agent gate.
        if (sub === 'agent' && req.method === 'GET') {
          const rec = await ctx.runs.record(id);
          const gateId = q('gate') || rec?.agent?.gateId;
          const kept = gateId ? await ctx.runs.kept(id, transcriptName(gateId)) : undefined;
          if (!kept) return json(res, 404, { error: 'no agent has answered this run' });
          return json(res, 200, kept);
        }
        if (sub === 'cancel' && req.method === 'POST') {
          await runs.cancel(id);
          return json(res, 200, await runs.snapshot(id));
        }
        if (sub === 'debug' && req.method === 'POST') return debugAction(ctx, id, call);
        return json(res, 200, await runs.withEvents(id));
      },
    },
  ];
}
