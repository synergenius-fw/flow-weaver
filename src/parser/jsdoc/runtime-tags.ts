/**
 * How a workflow's runtime tags are read: what starts it, how it is served,
 * what bounds it, and where it is deployed.
 *
 * `@trigger` (core `event=`/`cron=` forms, accumulated across tags; any other
 * form goes to a pack's `_trigger` handler), `@http` routes (method, path and
 * options checked here; a duplicate route keeps the first), `@cancelOn`,
 * `@throttle`, `@retries` and `@timeout` (an unquoted duration is accepted as
 * the quoted string), and `@deploy <target> key=value ...`, which node types
 * use too. A bad line is a warning and is dropped; the workflow still parses.
 */
import type { JSDocTag } from 'ts-morph';
import type { THttpRoute } from '../../ast/types';
import {
  parseTriggerLine,
  parseCancelOnLine,
  parseThrottleLine,
  parseRetriesLine,
  parseTimeoutLine,
} from '../../chevrotain-parser';
import type { TagHandlerRegistry } from '../tag-registry';
import type { JSDocWorkflowConfig } from './config-types';
import { parseLineOnce } from './parse-line-once';

/** The methods an `@http` route may declare. */
const HTTP_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Parse @trigger tag using Chevrotain parser.
 *
 * Core parses the built-in `event=` / `cron=` forms. Any other form is a
 * pack's to interpret: a pack registers a `_trigger` handler and core hands
 * the line to it. Core itself knows nothing about the domains a pack adds.
 */
export function parseTriggerTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[], tagRegistry?: TagHandlerRegistry): void {
  const comment = (tag.getCommentText() || '').trim();

  // Core FW trigger parsing (event= and/or cron=)
  const result = parseTriggerLine(`@trigger ${comment}`, warnings);
  if (result) {
    // Merge: multiple @trigger tags accumulate (event + cron can be separate tags)
    config.trigger = config.trigger || {};
    if (result.event) config.trigger.event = result.event;
    if (result.cron) config.trigger.cron = result.cron;
    return;
  }

  // Not a core trigger form: delegate to a pack's trigger handler if one is
  // registered. The pack writes into its own deploy namespace.
  if (tagRegistry && tagRegistry.has('_trigger')) {
    if (!config.deploy) config.deploy = {};
    tagRegistry.handle('_trigger', comment, 'workflow', config.deploy, warnings);
    return;
  }

  warnings.push(`Invalid @trigger format: @trigger ${comment}`);
}

/**
 * Parse @cancelOn tag using Chevrotain parser.
 */
export function parseCancelOnTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
  const comment = tag.getCommentText() || '';
  const result = parseLineOnce(parseCancelOnLine, `@cancelOn ${comment}`, warnings, `Invalid @cancelOn format: @cancelOn ${comment}`);
  if (!result) {
    return;
  }
  config.cancelOn = result;
}

/**
 * Parse @throttle tag using Chevrotain parser.
 */
export function parseThrottleTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
  const comment = tag.getCommentText() || '';
  const result = parseLineOnce(parseThrottleLine, `@throttle ${comment}`, warnings, `Invalid @throttle format: @throttle ${comment}`);
  if (!result) {
    return;
  }
  config.throttle = result;
}

/** Parse @retries tag. The grammar rejects `3abc` and warns; a negative value also warns. */
export function parseRetriesTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
  const comment = tag.getCommentText() || '';
  const result = parseRetriesLine(`@retries ${comment.trim()}`, warnings);
  if (result && result.retries >= 0) config.retries = result.retries;
}

/**
 * Parse @timeout tag. The duration is a quoted string in the grammar
 * (`@timeout "30m"`); an unquoted value is accepted as the same string.
 */
export function parseTimeoutTag(tag: JSDocTag, config: JSDocWorkflowConfig, warnings: string[]): void {
  const comment = tag.getCommentText() || '';
  const raw = comment.trim();
  const quoted = /^"(?:[^"\\]|\\.)*"$/.test(raw) ? raw : `"${raw.replace(/^['"]|['"]$/g, '')}"`;
  const result = parseTimeoutLine(`@timeout ${quoted}`, warnings);
  if (result && result.timeout) config.timeout = result.timeout;
}

/**
 * Parse @http tag: the route a workflow is served on.
 * Format: @http METHOD /path [mode=sync|async] [auth=bearer|none] [callback]
 *
 * Examples:
 *   @http POST /reviews
 *   @http GET /reviews/:path
 *   @http POST /reviews mode=async callback
 *
 * Several @http tags give several routes. A bad line is a warning and the
 * route is dropped; the workflow still parses.
 */
export function parseHttpTag(tag: JSDocTag, config: { http?: THttpRoute[] }, warnings: string[]): void {
  const text = (tag.getCommentText() || '').trim();
  const parts = text.split(/\s+/).filter(Boolean);
  const fail = (why: string) => { warnings.push(`Invalid @http: "${text}". ${why} Format: @http METHOD /path [mode=sync|async] [auth=bearer|none] [callback]`); };
  if (parts.length < 2) return fail('Give a method and a path.');
  const method = parts[0].toUpperCase();
  if (!HTTP_METHODS.has(method)) return fail(`"${parts[0]}" is not one of GET, POST, PUT, PATCH, DELETE.`);
  const routePath = parts[1];
  if (!/^\/(?:[A-Za-z0-9_\-.~%]+|:[A-Za-z_][A-Za-z0-9_]*)(?:\/(?:[A-Za-z0-9_\-.~%]+|:[A-Za-z_][A-Za-z0-9_]*))*\/?$|^\/$/.test(routePath)) {
    return fail(`"${routePath}" is not a path: it starts with / and its segments are words or :params.`);
  }
  const route: THttpRoute = { method: method as THttpRoute['method'], path: routePath.length > 1 ? routePath.replace(/\/$/, '') : routePath };
  for (const opt of parts.slice(2)) {
    const [key, raw] = opt.includes('=') ? opt.split('=', 2) : [opt, undefined];
    const value = raw?.replace(/^["']|["']$/g, '');
    if (key === 'mode' && (value === 'sync' || value === 'async')) { if (value === 'async') route.mode = 'async'; }
    else if (key === 'auth' && (value === 'bearer' || value === 'none')) { if (value === 'none') route.auth = 'none'; }
    else if (key === 'callback' && (value === undefined || value === 'true' || value === 'false')) { if (value !== 'false') route.callback = true; }
    else return fail(`"${opt}" is not an option.`);
  }
  config.http = config.http || [];
  if (config.http.some((r) => r.method === route.method && r.path === route.path)) {
    warnings.push(`Duplicate @http route ${route.method} ${route.path}. The first one stands.`);
    return;
  }
  config.http.push(route);
}

/**
 * Parse @deploy tag.
 * Format: @deploy <target> key=value key2="value with spaces" key3=123 key4=true
 *
 * Examples:
 *   @deploy my-target durableSteps=true framework="next" retries=3
 *   @deploy another-target memory=256 timeout=30 tags="a,b"
 *
 * Values are auto-coerced: "true"/"false" → boolean, numeric strings → number.
 */
export function parseDeployTag(tag: JSDocTag, deployMap: Record<string, Record<string, unknown>>): void {
  const text = (tag.getCommentText() || '').trim();
  if (!text) return;

  // Split target name from remaining key=value pairs
  const spaceIdx = text.indexOf(' ');
  const targetName = spaceIdx === -1 ? text : text.substring(0, spaceIdx);
  const rest = spaceIdx === -1 ? '' : text.substring(spaceIdx + 1);

  if (!targetName) return;

  if (!deployMap[targetName]) deployMap[targetName] = {};

  if (!rest) return;

  // Parse key=value and key="value with spaces" pairs
  // The quoted value pattern handles escaped quotes: "echo \"hello\""
  const kvRegex = /(\w[\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([\S]+))/g;
  let match: RegExpExecArray | null;
  while ((match = kvRegex.exec(rest)) !== null) {
    const key = match[1];
    const quotedVal = match[2]; // captured from "..."
    const bareVal = match[3];   // captured from unquoted

    if (quotedVal !== undefined) {
      // Quoted values: check if comma-separated list → string[]
      if (quotedVal.includes(',')) {
        deployMap[targetName][key] = quotedVal.split(',').map(v => v.trim());
      } else {
        deployMap[targetName][key] = quotedVal;
      }
    } else if (bareVal !== undefined) {
      // Bare values: auto-coerce boolean and number
      if (bareVal === 'true') {
        deployMap[targetName][key] = true;
      } else if (bareVal === 'false') {
        deployMap[targetName][key] = false;
      } else {
        const num = Number(bareVal);
        deployMap[targetName][key] = isNaN(num) ? bareVal : num;
      }
    }
  }
}
