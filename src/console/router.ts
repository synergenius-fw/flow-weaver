/**
 * The console's routes: a table per area, matched in order, and what every
 * route is handed.
 */
import type * as http from 'node:http';
import type { Supervisor } from './services.js';
import type { RunDriver } from './runs.js';
import type { ProfileCache } from './routes-agents.js';
import type { Json } from './respond.js';

/** What the routes share: the project, the pages following it, and the parts of the console. */
export interface ConsoleContext {
  /** The project the console is open on. It changes when another is opened. */
  projectDir(): string;
  /** Switch to another project: its listing, services, watcher and pack topics. */
  openProject(dir: string): Promise<void>;
  /** The absolute path, if it is inside the project; null otherwise. */
  inProject(p: string): string | null;
  /** Tell every following page something changed. */
  broadcast(msg: Json): void;
  /** The pages following every change, over `/api/events`. */
  followers: Set<http.ServerResponse>;
  /** Parse and validate the project's workflows in the background. */
  queueCheck(): void;
  /** The project's services. Replaced when the project changes. */
  supervisor(): Supervisor;
  profiles: ProfileCache;
  runs: RunDriver;
  /** Where the console is and what it watches, for the status page. */
  status(): { url: string; watching: boolean; runsDir: string };
  /** Where the client's files are served from. */
  client: { pageDir: string; scriptDir: string };
}

/** One request, as a route sees it. */
export interface Call {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  /** A query parameter, or the empty string. */
  q(name: string): string;
  /** The body, read as a JSON object. */
  body(): Promise<Json>;
  /** The groups of a pattern route's match; empty for a path route. */
  match: RegExpMatchArray | [];
}

export interface Route {
  /** Any method when omitted. */
  method?: string;
  /** An exact path, or a pattern over the whole path. */
  path: string | RegExp;
  handle(call: Call): unknown;
}

/** The first route for a method and path, with the pattern's match. */
export function findRoute(routes: readonly Route[], method: string, pathname: string): { route: Route; match: RegExpMatchArray | [] } | undefined {
  for (const route of routes) {
    if (route.method && route.method !== method) continue;
    if (typeof route.path === 'string') {
      if (route.path === pathname) return { route, match: [] };
    } else {
      const match = pathname.match(route.path);
      if (match) return { route, match };
    }
  }
  return undefined;
}
