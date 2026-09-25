/**
 * Everything around the workflows: the guide, the command line, packs,
 * export targets, the marketplace, and the project's status.
 */
import * as path from 'node:path';
import { searchDocs, readTopic, readTopicStructured, listTopics, getPackDocTopics } from '../docs/index.js';
import { guideOutline } from '../docs/guide.js';
import { searchAllRegistries } from '../marketplace/registry.js';
import { cliCatalog } from './cli-catalog.js';
import { planFwCommand, spawnFw } from './cli-run.js';
import { describePacks } from './packs.js';
import { listTargets, runExport } from './export.js';
import { detectPackProject, checkPackProject } from './author.js';
import { describeStatus } from './status.js';
import { errorCodeSection } from './workflow-view.js';
import { json, messageOf, send, sse, type Json } from './respond.js';
import type { ConsoleContext, Route } from './router.js';

/** How long a command from the command-line pane may run. */
const CLI_TIMEOUT_MS = 5 * 60 * 1000;

export function toolRoutes(ctx: ConsoleContext): Route[] {
  return [
    // An empty or one-letter query matches every topic with an empty
    // heading and excerpt, which is noise rather than a result list.
    {
      path: '/api/docs/search', handle: ({ res, q }) => {
        const query = q('q').trim();
        const limit = Math.min(80, Math.max(1, Number(q('limit')) || 12));
        return json(res, 200, query.length < 2 ? [] : searchDocs(query).filter((r) => r.heading).slice(0, limit));
      },
    },
    { path: '/api/docs/topics', handle: ({ res }) => json(res, 200, listTopics()) },
    {
      path: '/api/docs/guide',
      handle: ({ res }) => json(res, 200, guideOutline(listTopics(), new Set(getPackDocTopics().map((t) => t.slug)))),
    },
    // The page as markdown for rendering, its sections for the contents
    // list, and the compact form -- what `fw_docs` hands an assistant --
    // for copying into a conversation.
    {
      path: '/api/docs/topic', handle: ({ res, q }) => {
        const slug = q('slug');
        const full = readTopic(slug);
        if (!full) return json(res, 404, { error: `no topic ${slug}` });
        const structured = readTopicStructured(slug);
        return json(res, 200, {
          slug, name: full.name, description: full.description,
          sections: structured?.sections.map((s) => ({ heading: s.heading, level: s.level })) ?? [],
          markdown: full.content,
          compact: readTopic(slug, true)?.content ?? '',
        });
      },
    },
    { path: '/api/docs/error', handle: ({ res, q }) => json(res, 200, errorCodeSection(q('code'))) },

    // Core commands from the reference, then each installed pack's, so
    // completion knows `fw audio replay` as well as `fw validate`.
    {
      path: '/api/cli/commands', handle: async ({ res }) => {
        const packCommands = (await describePacks(ctx.projectDir())).flatMap((p) => p.cliCommands.map((c) => ({
          name: `${p.namespace} ${c.name}`, words: [p.namespace, c.name], group: `Pack: ${p.namespace}`,
          description: c.description, usage: c.usage, flags: c.flags, examples: [],
        })));
        return json(res, 200, [...cliCatalog(), ...packCommands]);
      },
    },
    // An fw command, run in the project, its output streamed back. The
    // argument list is spawned as is -- no shell -- and the child goes
    // when the page lets go of the stream.
    {
      method: 'POST', path: '/api/cli/run', handle: async ({ req, res, body }) => {
        const argv = (await body()).argv;
        const plan = planFwCommand(Array.isArray(argv) ? (argv as string[]) : []);
        if (!plan.ok) return json(res, 400, { error: plan.error });
        sse(res);
        const started = Date.now();
        const emit = (msg: Json) => send(res, msg);
        emit({ type: 'start', args: plan.args });
        let child: ReturnType<typeof spawnFw>;
        try { child = spawnFw(plan.args, ctx.projectDir()); }
        catch (err) { emit({ type: 'exit', code: null, error: messageOf(err), ms: 0 }); res.end(); return; }
        child.stdout?.on('data', (d: Buffer) => emit({ type: 'out', text: d.toString() }));
        child.stderr?.on('data', (d: Buffer) => emit({ type: 'err', text: d.toString() }));
        const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS);
        child.on('error', (err) => { emit({ type: 'exit', code: null, error: err.message, ms: Date.now() - started }); res.end(); });
        child.on('close', (code) => { clearTimeout(timer); emit({ type: 'exit', code, ms: Date.now() - started }); res.end(); });
        req.on('close', () => { clearTimeout(timer); if (child.exitCode === null) child.kill(); });
      },
    },

    { path: '/api/packs', handle: async ({ res }) => json(res, 200, await describePacks(ctx.projectDir())) },
    { path: '/api/export/targets', handle: async ({ res }) => json(res, 200, await listTargets(ctx.projectDir())) },
    {
      method: 'POST', path: '/api/export', handle: async ({ res, body }) => {
        const b = await body();
        const target = ctx.inProject(String(b.file));
        if (!target) return json(res, 400, { error: 'file is outside the project' });
        try {
          return json(res, 200, await runExport(ctx.projectDir(), {
            file: target, name: String(b.name), target: String(b.target),
            outputDir: typeof b.outputDir === 'string' && b.outputDir ? path.resolve(ctx.projectDir(), b.outputDir) : undefined,
            preview: b.preview !== false,
          }));
        } catch (err) {
          return json(res, 400, { error: messageOf(err) });
        }
      },
    },
    // The project as a pack: cheap to detect, slow to check (every source
    // file is parsed), so the check is a separate call made on request.
    { path: '/api/pack-project', handle: ({ res }) => json(res, 200, detectPackProject(ctx.projectDir())) },
    {
      path: '/api/pack-project/check', handle: async ({ res }) => {
        if (!detectPackProject(ctx.projectDir()).isPack) return json(res, 400, { error: 'the project is not a pack' });
        try { return json(res, 200, await checkPackProject(ctx.projectDir())); }
        catch (err) { return json(res, 400, { error: messageOf(err) }); }
      },
    },
    // The marketplace is npm: a search goes to the registry, and installing
    // is `fw market install`, which the command-line pane runs when asked
    // to. Every registry the project's npm uses is searched, credentials
    // included: a private pack is on a private registry, and .npmrc says which.
    {
      path: '/api/market/search',
      handle: async ({ res, q }) => json(res, 200, await searchAllRegistries({ query: q('q') || undefined, limit: 30, projectDir: ctx.projectDir() })),
    },
    // Everything around the project: services alive, MCP registrations,
    // the environment and registries. Probes are brief.
    { path: '/api/status', handle: async ({ res }) => json(res, 200, await describeStatus(ctx.projectDir(), ctx.status())) },
  ];
}
