/**
 * The client's files, the project, and its workflows: described, handed
 * over as artifacts, exposed over HTTP, and compared across git history.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { renderArtifact, ARTIFACT_KINDS, type ArtifactKind } from '../artifacts/index.js';
import { planRoutes } from '../server/api.js';
import type { THttpRoute } from '../ast/types.js';
import { fileHistory } from './git.js';
import { buildDiffView } from './diff-view.js';
import { scanWorkflowNames } from './scan.js';
import { astAt, crumbsFor, describeWorkflow, nodeTypeOf, parseOne, ports, routeFrom, setHttpRoutes } from './workflow-view.js';
import { describeServe } from './routes-services.js';
import { json, sendFile } from './respond.js';
import type { ConsoleContext, Route } from './router.js';
import { getErrorMessage } from '../utils/error-utils.js';

const OUTSIDE = { error: 'file is outside the project' };

export function projectRoutes(ctx: ConsoleContext): Route[] {
  const here = () => {
    const dir = ctx.projectDir();
    return { dir, name: path.basename(dir), parent: path.dirname(dir) };
  };
  const { pageDir, scriptDir } = ctx.client;

  return [
    { path: '/', handle: ({ res }) => sendFile(res, path.join(pageDir, 'index.html'), 'text/html') },
    { path: '/app.js', handle: ({ res }) => sendFile(res, path.join(scriptDir, 'app.js'), 'text/javascript') },
    { path: '/styles.css', handle: ({ res }) => sendFile(res, path.join(pageDir, 'styles.css'), 'text/css') },
    { path: '/synergenius.svg', handle: ({ res }) => sendFile(res, path.join(pageDir, 'assets', 'synergenius.svg'), 'image/svg+xml') },

    { method: 'GET', path: '/api/project', handle: ({ res }) => json(res, 200, here()) },
    // Opening another project. The console is a local tool driving a local
    // engine, so any directory the user can read is fair game -- but it
    // must exist, and the answer re-points the watcher and the containment
    // check together so neither is left pointing at the old project.
    {
      method: 'POST', path: '/api/project', handle: async ({ res, body }) => {
        const target = path.resolve(String((await body()).dir ?? ''));
        if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
          return json(res, 400, { error: `not a directory: ${target}` });
        }
        await ctx.openProject(target);
        return json(res, 200, here());
      },
    },
    // Directories to choose from, so the console can offer a picker
    // rather than asking someone to type a path.
    {
      path: '/api/browse', handle: ({ res, q }) => {
        const at = path.resolve(q('dir') || ctx.projectDir());
        try {
          const entries = fs.readdirSync(at, { withFileTypes: true })
            .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
            .map((e) => ({ name: e.name, dir: path.join(at, e.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));
          // The client cannot split an absolute path safely -- `/a/b` and
          // `C:\\a\\b` need different rules -- so the segments are built here.
          return json(res, 200, { dir: at, parent: path.dirname(at), entries, crumbs: crumbsFor(at) });
        } catch (err) {
          return json(res, 400, { error: getErrorMessage(err) });
        }
      },
    },
    {
      path: '/api/workflows', handle: async ({ res }) => {
        // Names first, so the rail fills immediately; the verdicts follow
        // over the event stream as each workflow is parsed.
        const list = scanWorkflowNames(ctx.projectDir());
        ctx.queueCheck();
        const counts = await ctx.runs.waitingCounts();
        return json(res, 200, list.map((w) => ctx.runs.withWaiting(w, counts)));
      },
    },
    // A workflow as something to hand to someone: a brief for people who
    // will not open the code, or the diagram. Sent as a download,
    // self-contained.
    {
      path: '/api/artifact', handle: async ({ res, q }) => {
        const target = ctx.inProject(q('file'));
        if (!target) return json(res, 400, OUTSIDE);
        const { ast, errors } = await parseOne(target, q('name'));
        if (!ast) return json(res, 400, { error: errors.join('\n') || 'does not parse' });
        const theme = q('theme') === 'dark' ? 'dark' : 'light';
        const kind = q('kind') as ArtifactKind;
        if (!ARTIFACT_KINDS.includes(kind)) return json(res, 400, { error: `unknown artifact ${kind}` });
        let artifact;
        try { artifact = await renderArtifact(ast, kind, { theme, subtitle: path.basename(ctx.projectDir()) }); }
        catch (e) { return json(res, 500, { error: getErrorMessage(e) }); }
        res.writeHead(200, { 'Content-Type': artifact.type, 'Content-Disposition': `attachment; filename="${ast.functionName}${artifact.extension}"`, 'Cache-Control': 'no-cache' });
        return res.end(artifact.body);
      },
    },
    {
      path: '/api/workflow', handle: async ({ res, q }) => {
        const file = ctx.inProject(q('file'));
        if (!file) return json(res, 400, OUTSIDE);
        return json(res, 200, await describeWorkflow(ctx.projectDir(), file, q('name')));
      },
    },
    // Expose a workflow as an endpoint, or change its routes: the @http
    // lines are rewritten, nothing else in the file is touched.
    {
      method: 'PUT', path: '/api/workflow/http', handle: async ({ res, body }) => {
        const b = await body();
        const target = ctx.inProject(String(b.file ?? ''));
        if (!target) return json(res, 400, OUTSIDE);
        const routes: THttpRoute[] = [];
        for (const raw of Array.isArray(b.routes) ? b.routes : []) {
          const r = routeFrom(raw);
          if (typeof r === 'string') return json(res, 400, { error: r });
          if (routes.some((x) => x.method === r.method && x.path === r.path)) return json(res, 400, { error: `${r.method} ${r.path} is listed twice` });
          routes.push(r);
        }
        const out = await setHttpRoutes(target, String(b.name ?? ''), routes);
        if (!out.ok) return json(res, 400, { error: out.error });
        return json(res, 200, await describeWorkflow(ctx.projectDir(), target, String(b.name)));
      },
    },
    // Every route the project declares, as one list: what `fw serve` or
    // an embedding would mount, and what it would refuse.
    {
      path: '/api/endpoints', handle: async ({ res }) => {
        const names = scanWorkflowNames(ctx.projectDir());
        const parsed = await Promise.all(names.map(async (w) => {
          const p = await parseOne(w.file, w.name);
          const ast = p.ast;
          const gates = ast ? ast.instances.filter((i) => nodeTypeOf(ast, i)?.durableGate !== undefined).length : 0;
          return { file: w.file, rel: w.rel, name: w.name, description: ast?.description ?? '', routes: ast?.options?.http ?? [], gates, params: ast ? ports(ast.startPorts) : [], returns: ast ? ports(ast.exitPorts) : [], parses: !!ast };
        }));
        const plan = planRoutes(parsed.map((w) => ({ name: w.name, routes: w.routes, w })));
        return json(res, 200, {
          workflows: parsed.filter((w) => w.routes.length).map(({ routes, ...w }) => ({ ...w, routes: routes.map((r) => ({ ...r, mounted: plan.mounted.some((m) => m.owner.name === w.name && m.route === r) })) })),
          candidates: parsed.filter((w) => !w.routes.length && w.parses).map(({ routes: _r, ...w }) => w),
          problems: plan.problems,
          serve: describeServe(ctx.supervisor()),
        });
      },
    },
    // Version control: the commits that touched a file, and two versions
    // of a workflow as one marked picture. `from`/`to` are git refs, or
    // `worktree` for the file as it is now.
    {
      path: '/api/git/history', handle: async ({ res, q }) => {
        const file = ctx.inProject(q('file'));
        if (!file) return json(res, 400, OUTSIDE);
        return json(res, 200, await fileHistory(file));
      },
    },
    {
      path: '/api/diff', handle: async ({ res, q }) => {
        const file = ctx.inProject(q('file'));
        if (!file) return json(res, 400, OUTSIDE);
        const name = q('name'), from = q('from') || 'HEAD', to = q('to') || 'worktree';
        const [a, b] = await Promise.all([astAt(file, name, from), astAt(file, name, to)]);
        if (!a.ast) return json(res, 400, { error: a.error });
        if (!b.ast) return json(res, 400, { error: b.error });
        return json(res, 200, { from, to, ...buildDiffView(a.ast, b.ast) });
      },
    },
  ];
}
