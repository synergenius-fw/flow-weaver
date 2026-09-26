import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { Command, Option } from 'commander';
import { parseWorkflow } from '../../../src/api/parse';
import { validateWorkflow } from '../../../src/api/validate';
import { buildProgram } from '../../../src/cli/program';
import type { TNodeTypeAST } from '../../../src/ast/types';
import { BUILT_IN_NODE_TYPES } from '../../../src/built-in-nodes/generated-registry';

/**
 * The code examples in docs/reference/*.md and README.md are checked against
 * the code, so they cannot drift from it:
 *
 * - a ts/typescript block with `@flowWeaver` is parsed and validated; it must
 *   parse cleanly (no errors, and no warnings, which mean an ignored line)
 *   and validate without errors (validation warnings are allowed). A bodiless
 *   function named like a built-in node type is a signature, compared with
 *   the built-in;
 * - a ts/typescript block importing from `@synergenius/flow-weaver...` is
 *   typechecked against the package's own source, all such blocks in one
 *   TypeScript program;
 * - every `fw` / `npx fw` invocation in a bash/sh block must name a real
 *   command and real options of the `fw` program (nothing is executed);
 * - a json block must parse (a jsonc block may carry comments).
 *
 * Other blocks (grammar, sample output, trees, unlabelled fragments, other
 * TypeScript) are not checked.
 *
 * A block can opt out or declare its intent with an HTML comment on the line
 * before its fence:
 *
 *   <!-- example: fragment -->        not checked (deliberately partial)
 *   <!-- example: invalid CODE -->    a workflow block that must report CODE
 *                                     (a parse or validation diagnostic)
 *
 * Use them sparingly: prefer an example that stands on its own. A library
 * snippet that needs something of the reader's declares it in the snippet
 * (`declare const myStore: RunStore;`).
 */

const repoRoot = process.cwd();
const docsDir = path.join(repoRoot, 'docs', 'reference');

interface DocBlock {
  /** Repo-relative path of the Markdown file. */
  file: string;
  /** 1-based line of the opening fence. */
  line: number;
  lang: string;
  code: string;
  marker?: { directive: string; argument?: string };
}

type BlockKind = 'workflow' | 'library' | 'shell' | 'json' | 'unchecked';

const MARKER_RE = /^<!--\s*example:\s*([a-z-]+)(?:\s+(\S+))?\s*-->$/;

function collectBlocks(): DocBlock[] {
  const files = [
    ...fs
      .readdirSync(docsDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => path.join('docs', 'reference', f)),
    'README.md',
  ];
  const blocks: DocBlock[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(repoRoot, file), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const open = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)/.exec(lines[i]);
      if (!open) continue;
      const [, indent, fence, lang] = open;
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (lines[j].trim() === fence) break;
        body.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j]);
      }
      let k = i - 1;
      while (k >= 0 && lines[k].trim() === '') k--;
      const markerMatch = k >= 0 ? MARKER_RE.exec(lines[k].trim()) : null;
      blocks.push({
        file,
        line: i + 1,
        lang: lang.toLowerCase(),
        code: body.join('\n'),
        marker: markerMatch ? { directive: markerMatch[1], argument: markerMatch[2] } : undefined,
      });
      i = j;
    }
  }
  return blocks;
}

function kindOf(block: DocBlock): BlockKind {
  if (block.lang === 'ts' || block.lang === 'typescript') {
    if (block.code.includes('@flowWeaver')) return 'workflow';
    if (/from\s+['"]@synergenius\/flow-weaver(\/[\w-]+)?['"]/.test(block.code)) return 'library';
    return 'unchecked';
  }
  if (block.lang === 'bash' || block.lang === 'sh' || block.lang === 'shell') {
    return fwInvocations(block).length > 0 ? 'shell' : 'unchecked';
  }
  if (block.lang === 'json' || block.lang === 'jsonc') return 'json';
  return 'unchecked';
}

/** Where a block's fence is, as file:line. */
const at = (block: DocBlock) => `${block.file}:${block.line}`;
/** Where a 0-based line of a block's body is, as file:line. */
const atLine = (block: DocBlock, offset: number) => `${block.file}:${block.line + 1 + offset}`;

const blocks = collectBlocks();
const byKind = (kind: BlockKind) =>
  blocks.filter((b) => kindOf(b) === kind && b.marker?.directive !== 'fragment');

// ---------------------------------------------------------------------------
// Workflow annotations
// ---------------------------------------------------------------------------

const JSDOC_RE = /\/\*\*[\s\S]*?\*\//g;

/** Names of the functions a block declares (`function x`, `const x =`). */
function declaredFunctions(code: string): Set<string> {
  const names = new Set<string>();
  for (const m of code.matchAll(/\b(?:function\s*\*?\s*|(?:const|let)\s+)([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  return names;
}

/** Node type names referenced by `@node <id> <type>` lines. */
function referencedNodeTypes(code: string): string[] {
  return [...code.matchAll(/@node\s+[\w$]+\s+([\w$/.-]+)/g)].map((m) => m[1]);
}

/** `@param` / `Start.x` and `@returns` / `Exit.x` names in one workflow comment. */
function stubSignature(comment: string): { params: string[]; returns: string[] } {
  const step = new Set(['execute', 'onSuccess', 'onFailure']);
  const params = new Set<string>();
  const returns = new Set<string>();
  for (const m of comment.matchAll(/@param\s+\[?([\w$]+)/g)) params.add(m[1]);
  for (const m of comment.matchAll(/@returns\s+([\w$]+)/g)) returns.add(m[1]);
  for (const m of comment.matchAll(/\bStart\.([\w$]+)/g)) params.add(m[1]);
  for (const m of comment.matchAll(/\bExit\.([\w$]+)/g)) returns.add(m[1]);
  return {
    params: [...params].filter((p) => !step.has(p)),
    returns: [...returns].filter((r) => !step.has(r)),
  };
}

/**
 * The file a workflow block is checked as. Two conventions keep the page
 * short without leaving its examples unchecked:
 *
 * - a workflow may use node types a block earlier on the same page defines
 *   (the definitions it needs are prepended);
 * - a `@flowWeaver workflow` comment with no function after it gets a stub
 *   function whose params and returns are the Start and Exit ports it names.
 */
function workflowSource(block: DocBlock): string {
  const own = declaredFunctions(block.code);
  const earlier = blocks.filter(
    (b) => b.file === block.file && b.line < block.line && kindOf(b) === 'workflow' && !b.marker,
  );
  const prepend: string[] = [];
  for (const type of referencedNodeTypes(block.code)) {
    if (own.has(type)) continue;
    for (const b of [...earlier].reverse()) {
      const definition = nodeTypeDefinitions(b.code).get(type);
      if (definition === undefined) continue;
      if (!prepend.includes(definition)) prepend.push(definition);
      break;
    }
  }

  let stubs = 0;
  const code = withBodies(block.code).replace(JSDOC_RE, (comment: string, offset: number, whole: string) => {
    if (!/@flowWeaver\s+workflow/.test(comment)) return comment;
    const rest = whole.slice(offset + comment.length);
    if (/^\s*(export\s|async\s|function\s|const\s)/.test(rest)) return comment;
    const { params, returns } = stubSignature(comment);
    const paramType = `{ ${params.map((p) => `${p}: any;`).join(' ')} }`;
    const returnType = `{ onSuccess: boolean; onFailure: boolean; ${returns.map((r) => `${r}: any;`).join(' ')} }`;
    return `${comment}\nexport function docExample${++stubs}(execute: boolean, params: ${paramType}): ${returnType} {\n  throw new Error('stub');\n}\n`;
  });
  return [...prepend.map(withBodies), code].join('\n\n');
}

/** Node type functions a block defines, by name, with their JSDoc. */
function nodeTypeDefinitions(code: string): Map<string, string> {
  const sourceFile = ts.createSourceFile('block.ts', code, ts.ScriptTarget.Latest, true);
  const definitions = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
    const text = statement.getFullText(sourceFile).trim();
    if (/@flowWeaver\s+nodeType/.test(text)) definitions.set(statement.name.text, text);
  }
  return definitions;
}

/** Functions a block declares without a body: a signature shown for reference. */
function signatureOnlyFunctions(code: string): ts.FunctionDeclaration[] {
  const sourceFile = ts.createSourceFile('block.ts', code, ts.ScriptTarget.Latest, true);
  return sourceFile.statements.filter(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.body === undefined && s.name !== undefined,
  );
}

/** The block with a throwing body on every function shown as a bare signature. */
function withBodies(code: string): string {
  let result = code;
  for (const fn of signatureOnlyFunctions(code).reverse()) {
    result = `${result.slice(0, fn.end)} {\n  throw new Error('signature');\n}${result.slice(fn.end)}`;
  }
  return result;
}

/** Ports as `name[?]:TYPE`, sorted, for comparing a signature with its source. */
function portSummary(ports: Record<string, { dataType: string; optional?: boolean }>): string[] {
  return Object.entries(ports)
    .map(([name, port]) => `${name}${port.optional ? '?' : ''}:${port.dataType}`)
    .sort();
}

/**
 * A signature block for a built-in node type (a bodiless function named like
 * one) must show the ports the built-in really has.
 */
function builtInSignatureDrift(block: DocBlock, docTypes: TNodeTypeAST[]): string[] {
  const drift: string[] = [];
  for (const fn of signatureOnlyFunctions(block.code)) {
    const name = fn.name?.text ?? '';
    const real = BUILT_IN_NODE_TYPES.find((t) => t.functionName === name);
    if (!real) continue;
    const shown = docTypes.find((t) => t.functionName === name);
    if (!shown) {
      drift.push(`built-in ${name}: not found`);
      continue;
    }
    for (const side of ['inputs', 'outputs'] as const) {
      const want = portSummary(real[side]).join(', ');
      const got = portSummary(shown[side]).join(', ');
      if (want !== got) drift.push(`built-in ${name} ${side}: the doc shows [${got}], the source has [${want}]`);
    }
    if (shown.durableGate !== real.durableGate) {
      drift.push(`built-in ${name}: the doc shows @durableGate ${shown.durableGate ?? '(none)'}, the source has ${real.durableGate ?? '(none)'}`);
    }
  }
  return drift;
}

/**
 * Modules the examples import through `@fwImport`, beside the example file:
 * npm packages stubbed with the real signature of the one function each
 * example uses, and the local module one example names. The example's port
 * names are checked against these without installing anything.
 */
const EXAMPLE_FILES: Record<string, string> = {
  'node_modules/lodash/index.d.ts': 'export declare function uniq<T>(array: T[]): T[];\n',
  'node_modules/validator/index.d.ts': 'export declare function isEmail(str: string, options?: object): boolean;\n',
  'utils.ts': 'export function formatDate(date: Date): string {\n  return date.toISOString();\n}\n',
};

// ---------------------------------------------------------------------------
// Shell: fw invocations
// ---------------------------------------------------------------------------

interface FwInvocation {
  /** 0-based line within the block. */
  offset: number;
  text: string;
  args: string[];
}

/** Split a shell command into words, honouring quotes and dropping comments. */
function shellWords(text: string): string[] {
  const words: string[] = [];
  let current = '';
  let inWord = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < text.length) current += text[++i];
      else current += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      inWord = true;
    } else if (c === '\\' && i + 1 < text.length) {
      current += text[++i];
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) words.push(current);
      current = '';
      inWord = false;
    } else if (c === '#' && !inWord) {
      break;
    } else {
      current += c;
      inWord = true;
    }
  }
  if (inWord) words.push(current);
  return words;
}

/** Every `fw ...` / `npx fw ...` command in a shell block, with its arguments. */
function fwInvocations(block: DocBlock): FwInvocation[] {
  const found: FwInvocation[] = [];
  const lines = block.code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const offset = i;
    let logical = lines[i];
    while (/\\\s*$/.test(logical) && i + 1 < lines.length) {
      logical = logical.replace(/\\\s*$/, ' ') + lines[++i];
    }
    // Split on command separators outside quotes (good enough for docs).
    for (const segment of logical.split(/&&|\|\||;|\|/)) {
      // A synopsis line (`fw run <input> [options]`) is checked too: a
      // `<placeholder>` stands for one argument, `[optional]` for none.
      const synopsis = segment
        .trim()
        .replace(/^\$\s+/, '')
        .replace(/<[^<>]*>/g, 'PLACEHOLDER')
        .replace(/\s\[[^[\]]*\]/g, '');
      const words = shellWords(synopsis);
      while (words.length > 0 && /^[A-Z_][A-Z0-9_]*=/.test(words[0])) words.shift();
      if (words[0] === 'npx' && words[1] === 'fw') words.shift();
      if (words[0] !== 'fw') continue;
      found.push({ offset, text: segment.trim(), args: words.slice(1) });
    }
  }
  return found;
}

function optionTakesValue(option: Option): boolean {
  return option.required || option.optional;
}

/** The option a flag names on a command (`--no-x` only when declared as such). */
function findOption(command: Command, flag: string): Option | undefined {
  return (command.options as readonly Option[]).find((o) => o.long === flag || o.short === flag);
}

/** Why an fw invocation would not parse against the program, or null. */
function checkInvocation(program: Command, args: string[]): string | null {
  let command = program;
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') break;
    if (arg.startsWith('-') && arg !== '-') {
      const [flag, inlineValue] = arg.startsWith('--') ? arg.split(/=(.*)/s) : [arg, undefined];
      if (flag === '-h' || flag === '--help') continue;
      const option = findOption(command, flag);
      if (!option) {
        return `unknown option ${flag} for \`${commandPath(command)}\``;
      }
      if (optionTakesValue(option) && inlineValue === undefined) {
        const next = args[i + 1];
        if (option.required) {
          if (next === undefined) return `option ${flag} needs a value`;
          i++;
        } else if (next !== undefined && !next.startsWith('-')) {
          i++;
        }
        if (option.variadic) {
          while (args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
        }
      }
      continue;
    }
    if (positionals.length === 0 && command.commands.length > 0) {
      const sub = command.commands.find((c) => c.name() === arg || c.aliases().includes(arg));
      if (sub) {
        command = sub;
        continue;
      }
      if (arg === 'help') return null;
      if (command.registeredArguments.length === 0) {
        return `unknown command \`${commandPath(command)} ${arg}\``;
      }
    }
    positionals.push(arg);
  }
  if (command === program && positionals.length > 0) {
    return `unknown command \`fw ${positionals[0]}\``;
  }
  const declared = command.registeredArguments;
  const variadic = declared.length > 0 && declared[declared.length - 1].variadic;
  if (!variadic && positionals.length > declared.length) {
    return `\`${commandPath(command)}\` takes ${declared.length} argument(s), got ${positionals.length}: ${positionals.join(' ')}`;
  }
  const required = declared.filter((a) => a.required).length;
  if (positionals.length < required) {
    return `\`${commandPath(command)}\` needs ${required} argument(s), got ${positionals.length}`;
  }
  return null;
}

function commandPath(command: Command): string {
  const names: string[] = [];
  for (let c: Command | null = command; c; c = c.parent) names.unshift(c.name());
  return names.join(' ');
}

// ---------------------------------------------------------------------------
// Library: typecheck all snippets in one program
// ---------------------------------------------------------------------------

/** `@synergenius/flow-weaver[/subpath]` -> the source entry it is built from. */
function packagePaths(): Record<string, string[]> {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    name: string;
    exports: Record<string, { types: string }>;
  };
  const paths: Record<string, string[]> = {};
  for (const [subpath, entry] of Object.entries(pkg.exports)) {
    const source = entry.types.replace(/^\.\/dist\//, 'src/').replace(/\.d\.ts$/, '.ts');
    const specifier = subpath === '.' ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
    paths[specifier] = [path.join(repoRoot, source)];
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('documentation code examples', () => {
  it('finds examples of every checked kind', () => {
    for (const kind of ['workflow', 'library', 'shell', 'json'] as const) {
      expect(byKind(kind).length, kind).toBeGreaterThan(0);
    }
  });

  it('uses only known markers, each on a checked block', () => {
    const bad: string[] = [];
    for (const block of blocks) {
      if (!block.marker) continue;
      const { directive, argument } = block.marker;
      const kind = kindOf(block);
      if (directive === 'fragment') {
        if (kind === 'unchecked') bad.push(`${at(block)}: fragment marker on an unchecked block`);
      } else if (directive === 'invalid') {
        if (kind !== 'workflow' || !argument) bad.push(`${at(block)}: invalid needs a CODE on a workflow block`);
      } else {
        bad.push(`${at(block)}: unknown directive ${directive}`);
      }
    }
    expect(bad).toEqual([]);
  });

  describe('workflow annotations parse and validate', () => {
    let tempDir: string;
    beforeAll(() => {
      const base = path.join(repoRoot, 'tests', 'temp');
      fs.mkdirSync(base, { recursive: true });
      tempDir = fs.mkdtempSync(path.join(base, 'doc-examples-'));
      for (const [file, content] of Object.entries(EXAMPLE_FILES)) {
        fs.mkdirSync(path.dirname(path.join(tempDir, file)), { recursive: true });
        fs.writeFileSync(path.join(tempDir, file), content);
      }
    });
    afterAll(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const cases = byKind('workflow').map((b) => [at(b), b] as const);
    it.each(cases)('%s', async (_name, block) => {
      const fileName = `${block.file.replace(/[/.]/g, '_')}_${block.line}.ts`;
      const filePath = path.join(tempDir, fileName);
      fs.writeFileSync(filePath, workflowSource(block));

      const errors: string[] = [];
      const codes = new Set<string>();
      const hasWorkflow = /@flowWeaver\s+workflow/.test(block.code);
      const first = await parseWorkflow(filePath, { nodeTypesOnly: !hasWorkflow });
      const names = first.availableWorkflows.length > 1 ? first.availableWorkflows : [undefined];
      for (const workflowName of names) {
        const parsed = workflowName ? await parseWorkflow(filePath, { workflowName }) : first;
        errors.push(...parsed.errors.map((e) => `parse: ${e}`));
        errors.push(...parsed.warnings.map((w) => `parse warning: ${w}`));
        if (parsed.errors.length > 0) continue;
        if (!hasWorkflow) {
          errors.push(...(builtInSignatureDrift(block, parsed.ast.nodeTypes)));
          continue;
        }
        const result = validateWorkflow(parsed.ast);
        for (const e of [...result.errors, ...result.warnings]) codes.add(e.code);
        errors.push(...result.errors.map((e) => `${e.code}: ${e.message}`));
      }

      if (block.marker?.directive === 'invalid') {
        const code = block.marker.argument ?? '';
        const reported = codes.has(code) || errors.some((e) => e.includes(code));
        expect(reported, `${at(block)} should report ${code}; got ${errors.join('; ') || 'nothing'}`).toBe(true);
      } else {
        expect(errors.length, `${at(block)}\n${errors.join('\n')}`).toBe(0);
      }
    });
  });

  describe('fw commands exist with those options', () => {
    const program = buildProgram();
    const invocations = byKind('shell').flatMap((block) =>
      fwInvocations(block).map((inv) => [`${atLine(block, inv.offset)} ${inv.text}`, inv] as const),
    );
    it.each(invocations)('%s', (_name, inv) => {
      const problem = checkInvocation(program, inv.args);
      expect(problem, problem ?? '').toBeNull();
    });
  });

  describe('json examples parse', () => {
    it.each(byKind('json').map((b) => [at(b), b] as const))('%s', (_name, block) => {
      if (block.lang === 'jsonc') {
        const parsed = ts.parseConfigFileTextToJson('example.jsonc', block.code);
        expect(parsed.error, at(block)).toBeUndefined();
      } else {
        expect(() => JSON.parse(block.code), at(block)).not.toThrow();
      }
    });
  });

  it('library examples typecheck against the package source', () => {
    const snippets = byKind('library');
    expect(snippets.length).toBeGreaterThan(0);

    const virtualDir = path.join(repoRoot, 'tests', 'temp', 'doc-examples-virtual');
    // Virtual files under the repo, so node_modules resolves as for a user.
    const files = new Map<string, DocBlock>();
    const contents = new Map<string, string>();
    snippets.forEach((block, n) => {
      const fileName = path.join(virtualDir, `snippet-${n}.ts`);
      files.set(fileName, block);
      contents.set(fileName, `${block.code}\nexport {};\n`);
    });

    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2022.d.ts'],
      types: ['node'],
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      noEmit: true,
      paths: packagePaths(),
    };
    const host = ts.createCompilerHost(options, true);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
      const text = contents.get(path.resolve(fileName));
      if (text !== undefined) return ts.createSourceFile(fileName, text, languageVersion, true);
      return getSourceFile(fileName, languageVersion, onError, shouldCreate);
    };
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (fileName) => contents.has(path.resolve(fileName)) || fileExists(fileName);
    const readFile = host.readFile.bind(host);
    host.readFile = (fileName) => contents.get(path.resolve(fileName)) ?? readFile(fileName);

    const program = ts.createProgram([...contents.keys()], options, host);
    const problems: string[] = [];
    for (const [fileName, block] of files) {
      const sourceFile = program.getSourceFile(fileName);
      if (!sourceFile) {
        problems.push(`${at(block)}: not loaded`);
        continue;
      }
      const diagnostics = [
        ...program.getSyntacticDiagnostics(sourceFile),
        ...program.getSemanticDiagnostics(sourceFile),
      ];
      for (const d of diagnostics) {
        const { line } = d.start !== undefined ? sourceFile.getLineAndCharacterOfPosition(d.start) : { line: 0 };
        const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
        problems.push(`${atLine(block, line)}: TS${d.code} ${message}`);
      }
    }
    expect(problems.length, problems.join('\n')).toBe(0);
  });
});
