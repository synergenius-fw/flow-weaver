/**
 * CI/CD tag handler for the TagHandlerRegistry.
 *
 * Handles all CI/CD annotation tags: @secret, @runner, @cache, @artifact,
 * @environment, @matrix, @service, @concurrency, @job, @stage, @variables,
 * @before_script, @tags, @includes, plus the synthetic _cicdTrigger tag
 * for CI/CD trigger variants of @trigger.
 *
 * Each parser writes to ctx.deploy (the 'cicd' namespace slot) using the
 * same structures as the former jsdoc-parser.ts private methods.
 */

import type { TTagHandlerFn } from '../../parser/tag-registry';

export const cicdTagHandler: TTagHandlerFn = (tagName, comment, ctx) => {
  const d = ctx.deploy;
  const warnings = ctx.warnings;
  const text = comment.trim();

  switch (tagName) {
    case 'secret':
      parseSecret(text, d, warnings);
      break;
    case 'runner': {
      const val = text.replace(/^["']|["']$/g, '');
      if (val) d['runner'] = val;
      break;
    }
    case 'cache':
      parseCache(text, d, warnings);
      break;
    case 'artifact':
      parseArtifact(text, d, warnings);
      break;
    case 'environment':
      parseEnvironment(text, d, warnings);
      break;
    case 'matrix':
      parseMatrix(text, d, warnings);
      break;
    case 'service':
      parseService(text, d, warnings);
      break;
    case 'concurrency':
      parseConcurrency(text, d, warnings);
      break;
    case 'job':
      parseJob(text, d, warnings);
      break;
    case 'stage':
      parseStage(text, d, warnings);
      break;
    case 'variables':
      parseVariables(text, d, warnings);
      break;
    case 'before_script':
      parseBeforeScript(text, d, warnings);
      break;
    case 'tags':
      parseTags(text, d, warnings);
      break;
    case 'includes':
      parseIncludes(text, d, warnings);
      break;
    case '_cicdTrigger':
      parseCicdTrigger(text, d, warnings);
      break;
  }
};

// ── Individual tag parsers ────────────────────────────────────────────

type DeployMap = Record<string, unknown>;

function parseSecret(text: string, d: DeployMap, warnings: string[]): void {
  if (!text) {
    warnings.push('Empty @secret tag. Expected: @secret SECRET_NAME - description');
    return;
  }
  const match = text.match(/^(\S+)(.*?)(?:\s+-\s+(.*))?$/);
  if (!match) {
    warnings.push(`Invalid @secret format: @secret ${text}`);
    return;
  }
  const name = match[1];
  const attrs = match[2] || '';
  const description = match[3]?.trim();

  const secret: { name: string; description?: string; platform?: 'github' | 'gitlab' | 'all'; scope?: string } = { name };
  if (description) secret.description = description;

  const scopeMatch = attrs.match(/scope\s*=\s*"([^"]+)"/);
  if (scopeMatch) secret.scope = scopeMatch[1];
  const platformMatch = attrs.match(/platform\s*=\s*"([^"]+)"/);
  if (platformMatch) {
    const validPlatforms = ['github', 'gitlab', 'all'] as const;
    const p = platformMatch[1] as (typeof validPlatforms)[number];
    if (validPlatforms.includes(p)) {
      secret.platform = p;
    } else {
      warnings.push(`Invalid @secret platform "${platformMatch[1]}". Must be: github, gitlab, or all`);
    }
  }

  const secrets = (d['secrets'] as typeof secret[] | undefined) ?? [];
  secrets.push(secret);
  d['secrets'] = secrets;
}

function parseCache(text: string, d: DeployMap, warnings: string[]): void {
  if (!text) {
    warnings.push('Empty @cache tag. Expected: @cache npm key="package-lock.json"');
    return;
  }
  const parts = text.match(/^(\S+)(.*)?$/);
  if (!parts) {
    warnings.push(`Invalid @cache format: @cache ${text}`);
    return;
  }
  const cache: { strategy: string; path?: string; key?: string } = { strategy: parts[1] };
  const rest = parts[2] || '';
  const keyMatch = rest.match(/key\s*=\s*"([^"]+)"/);
  if (keyMatch) cache.key = keyMatch[1];
  const pathMatch = rest.match(/path\s*=\s*"([^"]+)"/);
  if (pathMatch) cache.path = pathMatch[1];

  const caches = (d['caches'] as typeof cache[] | undefined) ?? [];
  caches.push(cache);
  d['caches'] = caches;
}

function parseArtifact(text: string, d: DeployMap, warnings: string[]): void {
  if (!text) {
    warnings.push('Empty @artifact tag. Expected: @artifact name path="dist/"');
    return;
  }
  const nameMatch = text.match(/^(\S+)/);
  if (!nameMatch) {
    warnings.push(`Invalid @artifact format: @artifact ${text}`);
    return;
  }
  const pathMatch = text.match(/path\s*=\s*"([^"]+)"/);
  if (!pathMatch) {
    warnings.push(`@artifact requires path="...": @artifact ${text}`);
    return;
  }
  const artifact: { name: string; path: string; retention?: number } = {
    name: nameMatch[1],
    path: pathMatch[1],
  };
  const retentionMatch = text.match(/retention\s*=\s*(\d+)/);
  if (retentionMatch) artifact.retention = parseInt(retentionMatch[1], 10);

  const artifacts = (d['artifacts'] as typeof artifact[] | undefined) ?? [];
  artifacts.push(artifact);
  d['artifacts'] = artifacts;
}

function parseEnvironment(text: string, d: DeployMap, warnings: string[]): void {
  if (!text) {
    warnings.push('Empty @environment tag. Expected: @environment production url="https://app.com"');
    return;
  }
  const nameMatch = text.match(/^(\S+)/);
  if (!nameMatch) {
    warnings.push(`Invalid @environment format: @environment ${text}`);
    return;
  }
  const env: { name: string; url?: string; reviewers?: number } = { name: nameMatch[1] };
  const urlMatch = text.match(/url\s*=\s*"([^"]+)"/);
  if (urlMatch) env.url = urlMatch[1];
  const reviewersMatch = text.match(/reviewers\s*=\s*(\d+)/);
  if (reviewersMatch) env.reviewers = parseInt(reviewersMatch[1], 10);

  const environments = (d['environments'] as typeof env[] | undefined) ?? [];
  environments.push(env);
  d['environments'] = environments;
}

function parseMatrix(text: string, d: DeployMap, warnings: string[]): void {
  if (!text) {
    warnings.push('Empty @matrix tag. Expected: @matrix node="18,20,22" os="ubuntu-latest"');
    return;
  }
  type MatrixData = { dimensions: Record<string, string[]>; include?: Record<string, string>[]; exclude?: Record<string, string>[] };
  const matrix = (d['matrix'] as MatrixData | undefined) ?? { dimensions: {} };
  d['matrix'] = matrix;

  const isInclude = text.startsWith('include ');
  const isExclude = text.startsWith('exclude ');

  if (isInclude || isExclude) {
    const rest = text.slice(isInclude ? 8 : 8);
    const entry: Record<string, string> = {};
    const kvRegex = /(\w[\w-]*)\s*=\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = kvRegex.exec(rest)) !== null) {
      entry[m[1]] = m[2];
    }
    if (Object.keys(entry).length > 0) {
      if (isInclude) {
        matrix.include = matrix.include || [];
        matrix.include.push(entry);
      } else {
        matrix.exclude = matrix.exclude || [];
        matrix.exclude.push(entry);
      }
    }
    return;
  }

  const kvRegex = /(\w[\w-]*)\s*=\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = kvRegex.exec(text)) !== null) {
    matrix.dimensions[m[1]] = m[2].split(',').map(v => v.trim());
  }
}

function parseService(text: string, d: DeployMap, warnings: string[]): void {
  if (!text) {
    warnings.push('Empty @service tag. Expected: @service postgres image="postgres:16"');
    return;
  }
  const nameMatch = text.match(/^(\S+)/);
  if (!nameMatch) {
    warnings.push(`Invalid @service format: @service ${text}`);
    return;
  }
  const imageMatch = text.match(/image\s*=\s*"([^"]+)"/);
  if (!imageMatch) {
    warnings.push(`@service requires image="...": @service ${text}`);
    return;
  }
  const svc: { name: string; image: string; env?: Record<string, string>; ports?: string[] } = {
    name: nameMatch[1],
    image: imageMatch[1],
  };
  const envMatch = text.match(/env\s*=\s*"([^"]+)"/);
  if (envMatch) {
    svc.env = {};
    for (const pair of envMatch[1].split(',')) {
      const [k, ...vParts] = pair.split('=');
      if (k && vParts.length > 0) svc.env[k.trim()] = vParts.join('=').trim();
    }
  }
  const portsMatch = text.match(/ports\s*=\s*"([^"]+)"/);
  if (portsMatch) {
    svc.ports = portsMatch[1].split(',').map(p => p.trim());
  }

  const services = (d['services'] as typeof svc[] | undefined) ?? [];
  services.push(svc);
  d['services'] = services;
}

function parseConcurrency(text: string, d: DeployMap, warnings: string[]): void {
  if (!text) {
    warnings.push('Empty @concurrency tag. Expected: @concurrency group="deploy"');
    return;
  }
  const groupMatch = text.match(/group\s*=\s*"([^"]+)"/);
  if (!groupMatch) {
    const bareMatch = text.match(/^(\S+)/);
    if (bareMatch) {
      d['concurrency'] = { group: bareMatch[1], cancelInProgress: false };
    } else {
      warnings.push(`Invalid @concurrency format: @concurrency ${text}`);
    }
    return;
  }
  const cancelMatch = text.match(/cancel-in-progress\s*=\s*(true|false)/);
  d['concurrency'] = {
    group: groupMatch[1],
    cancelInProgress: cancelMatch ? cancelMatch[1] === 'true' : false,
  };
}

function parseJob(text: string, d: DeployMap, warnings: string[]): void {
  if (!text) {
    warnings.push('Empty @job tag. Expected: @job <name> key=value ...');
    return;
  }

  const spaceIdx = text.indexOf(' ');
  const jobId = spaceIdx === -1 ? text : text.substring(0, spaceIdx);
  const rest = spaceIdx === -1 ? '' : text.substring(spaceIdx + 1);

  type JobConfig = {
    id: string; retry?: number; allowFailure?: boolean; timeout?: string;
    variables?: Record<string, string>; tags?: string[]; beforeScript?: string[];
    rules?: Array<{ if?: string; when?: string; allowFailure?: boolean; variables?: Record<string, string>; changes?: string[] }>;
    coverage?: string; reports?: Array<{ type: string; path: string }>;
    runner?: string; extends?: string;
  };

  const jobs = (d['jobs'] as JobConfig[] | undefined) ?? [];
  d['jobs'] = jobs;

  let jc = jobs.find(j => j.id === jobId);
  if (!jc) {
    jc = { id: jobId };
    jobs.push(jc);
  }

  if (!rest) return;

  const kvRegex = /(\w[\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([\S]+))/g;
  let match: RegExpExecArray | null;
  while ((match = kvRegex.exec(rest)) !== null) {
    const key = match[1];
    const value = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4];

    switch (key) {
      case 'retry': {
        const n = parseInt(value, 10);
        if (!isNaN(n) && n >= 0) jc.retry = n;
        else warnings.push(`Invalid retry value "${value}" in @job ${jobId}`);
        break;
      }
      case 'allow_failure':
        jc.allowFailure = value === 'true';
        break;
      case 'timeout':
        jc.timeout = value;
        break;
      case 'runner':
        jc.runner = value;
        break;
      case 'tags':
        jc.tags = value.split(',').map(t => t.trim()).filter(Boolean);
        break;
      case 'coverage':
        jc.coverage = value;
        break;
      case 'extends':
        jc.extends = value;
        break;
      case 'variables': {
        jc.variables = jc.variables || {};
        for (const pair of value.split(',')) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx > 0) {
            jc.variables[pair.substring(0, eqIdx).trim()] = pair.substring(eqIdx + 1).trim();
          }
        }
        break;
      }
      case 'before_script':
        jc.beforeScript = value.split(',').map(s => s.trim()).filter(Boolean);
        break;
      case 'rules':
        jc.rules = jc.rules || [];
        jc.rules.push({ if: value });
        break;
      case 'when': {
        // Modifier: sets `when` on the last rule, or creates a standalone rule
        jc.rules = jc.rules || [];
        if (jc.rules.length === 0) jc.rules.push({});
        jc.rules[jc.rules.length - 1].when = value;
        break;
      }
      case 'changes': {
        // Modifier: sets `changes` on the last rule
        jc.rules = jc.rules || [];
        if (jc.rules.length === 0) jc.rules.push({});
        jc.rules[jc.rules.length - 1].changes = value.split(',').map(s => s.trim()).filter(Boolean);
        break;
      }
      case 'reports': {
        jc.reports = jc.reports || [];
        for (const pair of value.split(',')) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx > 0) {
            jc.reports.push({
              type: pair.substring(0, eqIdx).trim(),
              path: pair.substring(eqIdx + 1).trim(),
            });
          }
        }
        break;
      }
      default:
        warnings.push(`Unknown @job attribute "${key}" in @job ${jobId}`);
    }
  }
}

function parseStage(text: string, d: DeployMap, warnings: string[]): void {
  if (!text) {
    warnings.push('Empty @stage tag. Expected: @stage <name>');
    return;
  }
  type StageData = { name: string };
  const stages = (d['stages'] as StageData[] | undefined) ?? [];
  d['stages'] = stages;

  const name = text.split(/\s+/)[0];
  if (!stages.some(s => s.name === name)) {
    stages.push({ name });
  }
}

function parseVariables(text: string, d: DeployMap, warnings: string[]): void {
  if (!text) {
    warnings.push('Empty @variables tag. Expected: @variables KEY=VALUE');
    return;
  }
  const variables = (d['variables'] as Record<string, string> | undefined) ?? {};
  d['variables'] = variables;

  const kvRegex = /(\w[\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|(\S+))/g;
  let match: RegExpExecArray | null;
  while ((match = kvRegex.exec(text)) !== null) {
    variables[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }
}

function parseBeforeScript(text: string, d: DeployMap, warnings: string[]): void {
  if (!text) {
    warnings.push('Empty @before_script tag. Expected: @before_script "cmd1" "cmd2"');
    return;
  }
  const beforeScript = (d['beforeScript'] as string[] | undefined) ?? [];
  d['beforeScript'] = beforeScript;

  const strRegex = /"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  const commands: string[] = [];
  while ((match = strRegex.exec(text)) !== null) {
    commands.push(match[1]);
  }
  if (commands.length > 0) {
    beforeScript.push(...commands);
  } else {
    beforeScript.push(text);
  }
}

function parseTags(text: string, d: DeployMap, warnings: string[]): void {
  if (!text) {
    warnings.push('Empty @tags tag. Expected: @tags tag1 tag2');
    return;
  }
  d['tags'] = text.split(/[\s,]+/).filter(Boolean);
}

function parseIncludes(text: string, d: DeployMap, warnings: string[]): void {
  if (!text) {
    warnings.push('Empty @includes tag. Expected: @includes local="path"');
    return;
  }
  type IncludeData = { type: 'local' | 'project' | 'remote' | 'template'; file: string; project?: string; ref?: string };
  const includes = (d['includes'] as IncludeData[] | undefined) ?? [];
  d['includes'] = includes;

  const localMatch = text.match(/local\s*=\s*"([^"]+)"/);
  const templateMatch = text.match(/template\s*=\s*"([^"]+)"/);
  const remoteMatch = text.match(/remote\s*=\s*"([^"]+)"/);
  const projectMatch = text.match(/project\s*=\s*"([^"]+)"/);

  if (localMatch) {
    includes.push({ type: 'local', file: localMatch[1] });
  } else if (templateMatch) {
    includes.push({ type: 'template', file: templateMatch[1] });
  } else if (remoteMatch) {
    includes.push({ type: 'remote', file: remoteMatch[1] });
  } else if (projectMatch) {
    const fileMatch = text.match(/file\s*=\s*"([^"]+)"/);
    const refMatch = text.match(/ref\s*=\s*"([^"]+)"/);
    if (fileMatch) {
      includes.push({
        type: 'project',
        file: fileMatch[1],
        project: projectMatch[1],
        ...(refMatch && { ref: refMatch[1] }),
      });
    } else {
      warnings.push(`@includes project requires file="...": @includes ${text}`);
    }
  } else {
    warnings.push(`Invalid @includes format: @includes ${text}. Expected: @includes local="path" or @includes template="name"`);
  }
}

function parseCicdTrigger(text: string, d: DeployMap, warnings: string[]): void {
  // Check for CI/CD trigger types: push, pull_request, dispatch, tag, schedule
  const cicdMatch = text.match(/^(push|pull_request|dispatch|tag|schedule)\b(.*)?$/);
  if (!cicdMatch) {
    // Also detect standalone cron="..." as schedule trigger
    const cronOnlyMatch = text.match(/^cron\s*=\s*"([^"]+)"/);
    if (cronOnlyMatch) {
      const triggers = (d['triggers'] as unknown[] | undefined) ?? [];
      d['triggers'] = triggers;
      triggers.push({ type: 'schedule', cron: cronOnlyMatch[1] });
      return;
    }
    warnings.push(`Invalid CI/CD trigger format: @trigger ${text}`);
    return;
  }

  const type = cicdMatch[1];
  const rest = (cicdMatch[2] || '').trim();

  const triggerType = type as 'push' | 'pull_request' | 'schedule' | 'dispatch' | 'tag';
  const trigger: {
    type: 'push' | 'pull_request' | 'schedule' | 'dispatch' | 'tag';
    branches?: string[]; paths?: string[]; pathsIgnore?: string[];
    pattern?: string; types?: string[]; cron?: string;
    inputs?: Record<string, { description?: string; required?: boolean; default?: string; type?: string }>;
  } = { type: triggerType };

  const branchesMatch = rest.match(/branches\s*=\s*"([^"]+)"/);
  if (branchesMatch) trigger.branches = branchesMatch[1].split(',').map(b => b.trim());

  const pathsMatch = rest.match(/(?<![a-z])paths\s*=\s*"([^"]+)"/);
  if (pathsMatch) trigger.paths = pathsMatch[1].split(',').map(p => p.trim());

  const pathsIgnoreMatch = rest.match(/paths-ignore\s*=\s*"([^"]+)"/);
  if (pathsIgnoreMatch) trigger.pathsIgnore = pathsIgnoreMatch[1].split(',').map(p => p.trim());

  const typesMatch = rest.match(/types\s*=\s*"([^"]+)"/);
  if (typesMatch) trigger.types = typesMatch[1].split(',').map(t => t.trim());

  const patternMatch = rest.match(/pattern\s*=\s*"([^"]+)"/);
  if (patternMatch) trigger.pattern = patternMatch[1];

  const cronMatch = rest.match(/cron\s*=\s*"([^"]+)"/);
  if (cronMatch) trigger.cron = cronMatch[1];

  const inputsMatch = rest.match(/inputs\s*=\s*"([^"]+)"/);
  if (inputsMatch) {
    trigger.inputs = {};
    for (const input of inputsMatch[1].split(',')) {
      const name = input.trim();
      if (name) trigger.inputs[name] = {};
    }
  }

  const triggers = (d['triggers'] as typeof trigger[] | undefined) ?? [];
  d['triggers'] = triggers;
  triggers.push(trigger);
}
