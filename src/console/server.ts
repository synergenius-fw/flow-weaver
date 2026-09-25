/**
 * `fw console`: a local operator console over a project's workflows.
 *
 * A thin HTTP + SSE layer over what the runtime already exposes:
 * parseWorkflow / validateWorkflow / buildProcessModel for the static side,
 * the local coordinator for real runs, searchDocs / readTopicStructured for
 * documentation. This file sets the console up and routes each request to
 * one of the route tables beside it.
 *
 * Runs live in the coordinator's store (the project's `.fw/runs`), the same
 * one `fw_run` and `fw_resume` write to. So a run started here can be
 * answered by an assistant over MCP and the other way round, a gate waiting
 * here survives a restart, effects get receipts, and the console holds only
 * the segment of execution it is driving at this moment.
 */
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FSWatcher } from 'chokidar';
import { createLocalCoordinator, defaultRunsDir, reclaimStaleAgentAnswers, type RunStore } from '../coordinator/index.js';
import { loadPackDocTopics } from '../docs/pack-topics.js';
import { Supervisor, type SupervisorOptions } from './services.js';
import { checkWorkflows, invalidateListing } from './scan.js';
import { createRunDriver } from './runs.js';
import { createProfileCache, agentRoutes } from './routes-agents.js';
import { projectRoutes } from './routes-project.js';
import { toolRoutes } from './routes-tools.js';
import { serviceRoutes } from './routes-services.js';
import { runRoutes } from './routes-runs.js';
import { findRoute, type ConsoleContext, type Route } from './router.js';
import { refusal } from './request-guard.js';
import { BadRequest, json, messageOf, readBody, send, type Json } from './respond.js';

export interface ConsoleServerOptions {
  /** Directory whose workflows the console shows. */
  projectDir: string;
  port?: number;
  host?: string;
  /** Directory holding the built client (`index.html`, `app.js`, `styles.css`). Resolved automatically when omitted. */
  assetsDir?: string;
  /** Re-list and re-validate when files under the project change. Default true. */
  watch?: boolean;
  /** Called when the project is switched from the console. */
  onProject?: (dir: string) => void;
  /**
   * The run store to show and drive, in place of the directory under
   * `~/.fw/runs`: the same store your `createWorkflowApi` instances use, so
   * a person here answers the gates they reach. Changes made elsewhere are
   * picked up by polling, since a store of yours has no directory to watch.
   */
  store?: RunStore;
  /** How the project's services are started. A test hands in a fake spawn and its own directories. */
  services?: Pick<SupervisorOptions, 'spawn' | 'settingsDir' | 'registryDir'>;
}

export interface ConsoleServer {
  url: string;
  close(): Promise<void>;
}

export interface ConsoleServer {
  url: string;
  close(): Promise<void>;
}

export { stepLabel } from '../diagram/labels.js';

// ----------------------------------------------------------------- assets

/**
 * The built client lives in `dist/console`. Depending on how this module is
 * loaded that is beside it (`dist/console/server.js`), beside the CLI bundle
 * (`dist/cli/flow-weaver.mjs`) or, when running from source with tsx, two
 * levels up.
 */
function resolveAssets(explicit?: string): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [explicit, here, path.join(here, '..', 'console'), path.join(here, '..', '..', 'dist', 'console')].filter(Boolean) as string[];
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'index.html')) && fs.existsSync(path.join(dir, 'app.js')));
}

/**
 * Running from a source checkout without a build: bundle the client on the
 * fly and rebuild on change. Never taken from an installed package.
 */
async function devBuild(onRebuilt: () => void): Promise<{ serveFrom: string; scriptFrom: string } | undefined> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const uiDir = path.join(here, '..', '..', 'console-ui');
  if (!fs.existsSync(path.join(uiDir, 'src', 'main.tsx'))) return undefined;
  let esbuild: typeof import('esbuild');
  try { esbuild = await import('esbuild'); } catch { return undefined; }
  // Its own directory: `npm run build:console` writes a minified bundle to
  // dist/console, and sharing the path would have the two overwrite each
  // other depending on which ran last.
  const out = path.join(here, '..', '..', 'dist', '.console-dev');
  fs.mkdirSync(out, { recursive: true });
  const ctx = await esbuild.context({
    entryPoints: [path.join(uiDir, 'src', 'main.tsx')],
    bundle: true, outfile: path.join(out, 'app.js'), format: 'esm', target: 'es2022',
    jsx: 'automatic', jsxImportSource: 'preact', sourcemap: 'inline', logLevel: 'warning', absWorkingDir: uiDir,
    plugins: [{ name: 'reload', setup(b) { b.onEnd((res) => { if (!res.errors.length) onRebuilt(); }); } }],
  });
  await ctx.watch();
  // `index.html`, `styles.css` and `assets/` are served from source in dev,
  // so editing them needs no restart; a reload is pushed when any changes.
  const chokidar = await import('chokidar');
  chokidar.watch([path.join(uiDir, 'index.html'), path.join(uiDir, 'styles.css')], { ignoreInitial: true }).on('all', onRebuilt);
  return { serveFrom: uiDir, scriptFrom: out };
}

// ----------------------------------------------------------------- server

/**
 * The absolute path, if it is inside the directory; null otherwise.
 *
 * Compared case-insensitively on Windows and macOS, where `C:\\Proj` and
 * `c:\\proj` are the same directory and a case-sensitive check would
 * refuse a file the user legitimately opened.
 */
function within(root: string, p: string): string | null {
  if (!p) return null;
  const abs = path.resolve(p);
  const fold = (x: string) => (path.sep === '\\' || process.platform === 'darwin' ? x.toLowerCase() : x);
  const a = fold(abs);
  const r = fold(root);
  return a === r || a.startsWith(r + path.sep) ? abs : null;
}

export async function createConsoleServer(options: ConsoleServerOptions): Promise<ConsoleServer> {
  // The project can be changed from the console, so this is not a constant:
  // the watcher, the scan and the path-containment check all follow it.
  let projectDir = path.resolve(options.projectDir);
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4311;
  const watching = options.watch !== false;
  const followers = new Set<http.ServerResponse>();
  const broadcast = (msg: Json) => { for (const res of followers) send(res, msg); };

  // The store follows the project the console is opened on, not the directory
  // the console process was launched from. An MCP server started elsewhere but
  // pointed at a file in this project resolves the same <projectRoot>/.fw/runs,
  // so a run it starts shows up here. FW_RUNS_DIR still overrides both.
  const runsDir = defaultRunsDir(projectDir);
  const coordinator = createLocalCoordinator(options.store ? { store: options.store } : { rootDir: runsDir });
  // A process that died while a profile was answering must not keep the
  // gate locked against a person.
  await reclaimStaleAgentAnswers(coordinator).catch(() => undefined);

  const profiles = createProfileCache(() => projectDir);
  const runs = createRunDriver({ coordinator, broadcast, projectDir: () => projectDir, profiles: () => profiles.get() });

  /**
   * The project's services: ours, and those the registry knows. A change of
   * state is broadcast so every page refreshes; the lines go to whoever
   * opened the log stream.
   */
  const superviseFor = (dir: string) => new Supervisor({
    projectDir: dir,
    ...options.services,
    onChange: (e) => { if (!e.line) broadcast({ type: 'services', kind: e.kind, state: e.state, url: e.url ?? null, exitCode: e.exitCode ?? null, error: e.error ?? null }); },
  });
  let supervisor = superviseFor(projectDir);

  /**
   * Parse and validate in the background, announcing each verdict.
   *
   * Only one pass runs at a time: the console re-lists on every file
   * change, and a project of any size takes long enough that overlapping
   * passes would pile up.
   */
  let checking: Promise<void> | undefined;
  function queueCheck(): void {
    if (checking) return;
    const dir = projectDir;
    checking = checkWorkflows(dir, (summary) => {
      if (dir === projectDir) broadcast({ type: 'checked', workflow: runs.withWaiting(summary) });
    })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => { checking = undefined; });
  }

  // ---- live updates
  let watcher: FSWatcher | undefined;
  async function watchProject(): Promise<void> {
    if (!watching) return;
    await watcher?.close();
    const chokidar = await import('chokidar');
    watcher = chokidar.watch(projectDir, {
      ignoreInitial: true,
      ignored: (p: string) => /(^|[\\/])(node_modules|dist|\.git|\.fw)([\\/]|$)/.test(p) || /(^|[\\/])\.fw-diff-/.test(p),
    });
    watcher.on('all', (_event, file) => {
      if (typeof file === 'string' && file.endsWith('.ts')) {
        // A file may have gained or lost a workflow, so the listing is stale.
        invalidateListing(projectDir);
        broadcast({ type: 'changed', file });
      }
    });
  }
  await watchProject();
  // Packs installed in the project may bring topics of their own.
  await loadPackDocTopics(projectDir).catch(() => 0);
  // The store is shared with `fw_run`/`fw_resume`: a gate answered from an
  // assistant, or a run started there, shows up here as it happens.
  await runs.follow({ watching, runsDir: options.store ? undefined : runsDir });

  const heartbeat = setInterval(() => {
    for (const res of followers) res.write(': ping\n\n');
    runs.ping();
  }, 15000);

  // ---- client assets. In a source checkout the live client wins, so that
  // editing `console-ui/` takes effect even when a built dist/console from
  // an earlier `npm run build` is sitting there. An installed package has
  // no source tree, so it falls through to the built one.
  const dev = options.assetsDir ? undefined : await devBuild(() => broadcast({ type: 'client' }));
  const built = dev ? undefined : resolveAssets(options.assetsDir);
  if (!built && !dev) throw new Error('console client not found: run `npm run build:console`, or pass assetsDir');

  let actualPort = port;
  const ctx: ConsoleContext = {
    projectDir: () => projectDir,
    async openProject(dir) {
      projectDir = dir;
      invalidateListing(projectDir);
      // The services were the old project's; this one gets its own.
      await supervisor.close().catch(() => undefined);
      supervisor = superviseFor(projectDir);
      await watchProject();
      await loadPackDocTopics(projectDir).catch(() => 0);
      options.onProject?.(projectDir);
      broadcast({ type: 'project' });
    },
    inProject: (p) => within(projectDir, p),
    broadcast,
    followers,
    queueCheck,
    supervisor: () => supervisor,
    profiles,
    runs,
    status: () => ({ url: `http://${host}:${actualPort}`, watching, runsDir: options.store ? 'a run store of your own' : runsDir }),
    client: { pageDir: dev?.serveFrom ?? built!, scriptDir: dev?.scriptFrom ?? built! },
  };
  const routes: Route[] = [...projectRoutes(ctx), ...toolRoutes(ctx), ...agentRoutes(ctx), ...serviceRoutes(ctx), ...runRoutes(ctx)];

  // ---- http
  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const refused = refusal(req, host);
    if (refused) return json(res, 403, { error: refused });
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://${host}`);
    } catch {
      return json(res, 400, { error: 'the request target is not a valid URL' });
    }
    try {
      const found = findRoute(routes, req.method ?? 'GET', url.pathname);
      if (!found) return json(res, 404, { error: 'not found' });
      await found.route.handle({ req, res, url, match: found.match, q: (k) => url.searchParams.get(k) ?? '', body: () => readBody(req) });
    } catch (err) {
      // A stream that already started (an event stream) cannot turn into an
      // error response; closing it is the only answer left.
      if (res.headersSent) { res.destroy(); return; }
      json(res, err instanceof BadRequest ? 400 : 500, { error: messageOf(err) });
    }
  };
  const server = http.createServer((req, res) => {
    // handle() answers every failure itself; this catch is the last guard, so
    // nothing a request does can become an unhandled rejection that stops the console.
    handle(req, res).catch(() => res.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  actualPort = typeof address === 'object' && address ? address.port : port;

  // The services this project asked to have running with the console.
  for (const kind of ['serve', 'watch'] as const) {
    if (supervisor.settings()[kind].autoStart) { try { supervisor.start(kind); } catch { /* the card says why */ } }
  }

  return {
    url: `http://${host}:${actualPort}`,
    async close() {
      clearInterval(heartbeat);
      // Services the console started stop with it: one rule, no orphans.
      await supervisor.close().catch(() => undefined);
      await watcher?.close();
      await runs.close();
      for (const res of followers) res.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
