import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const legacySignals = [
  'executeWorkflowFromFile',
  'agent-channel',
  'AgentChannel',
  'agentChannel',
  '__fw_agent_channel__',
  'run-registry',
  'CheckpointWriter',
  'loadCheckpoint',
  'findLatestCheckpoint',
  '.fw-checkpoints',
  'fw_resume_from_checkpoint',
  '--checkpoint',
  '--resume',
  '__flowWeaverDebugger__',
  '__abortSignal__',
  '_pendingApprovals',
  'new Promise<ApprovalResult>',
] as const;

const legacyPattern = new RegExp(
  legacySignals.map((signal) => signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
);

const productionBoundaryPattern = new RegExp(
  [
    '@stitch/',
    'stitch\\.executor',
    'STITCH_(?:EXECUTOR|HOST|RUNNER)',
    'sealed[-_ ]bundle',
    'precompiled[-_ ]executor',
    'ExecutorProtocol',
    'ExecutorSession',
    'protocolVersion\\s*[:=]\\s*[12](?:\\D|$)',
  ].join('|'),
  'i',
);

function trackedTextFiles(): readonly string[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
    .filter((file) => fs.existsSync(path.join(repositoryRoot, file)))
    .filter((file) => !fs.readFileSync(path.join(repositoryRoot, file)).includes(0));
}

function matchingFiles(): readonly string[] {
  return trackedTextFiles().filter((file) =>
    legacyPattern.test(fs.readFileSync(path.join(repositoryRoot, file), 'utf8')),
  );
}

interface SourceInput {
  readonly file: string;
  readonly text: string;
}

function generatedCallerCutoverOffenders(additionalSources: readonly SourceInput[] = []): readonly string[] {
  const sources: SourceInput[] = trackedTextFiles()
    .filter((file) => /^tests\/.*\.test\.ts$/.test(file))
    .map((file) => ({
      file,
      text: fs.readFileSync(path.join(repositoryRoot, file), 'utf8'),
    }));
  sources.push(...additionalSources);
  const offenders: string[] = [];

  const unwrap = (node: ts.Expression): ts.Expression => {
    let current = node;
    while (
      ts.isAwaitExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isSatisfiesExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  };
  const dynamicGeneratedImport = (node: ts.Expression): boolean => {
    const current = unwrap(node);
    return (
      ts.isCallExpression(current) &&
      current.expression.kind === ts.SyntaxKind.ImportKeyword &&
      current.arguments.length === 1 &&
      !ts.isStringLiteral(current.arguments[0])
    );
  };
  const rootIdentifier = (node: ts.Expression): string | undefined => {
    let current = unwrap(node);
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      current = current.expression;
    }
    return ts.isIdentifier(current) ? current.text : undefined;
  };
  const isGeneratedExecuteArgument = (node: ts.Expression): boolean => {
    const current = unwrap(node);
    return (
      current.kind === ts.SyntaxKind.TrueKeyword ||
      current.kind === ts.SyntaxKind.FalseKeyword ||
      (ts.isIdentifier(current) && current.text === 'execute')
    );
  };

  for (const { file, text } of sources) {
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const moduleBindings = new Set<string>();
    const workflowBindings = new Set<string>();
    const generatedModuleParameters = new Set<string>();

    const collectModules = (node: ts.Node): void => {
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node) ||
          ts.isMethodDeclaration(node)) &&
        node.parameters.length > 0
      ) {
        for (const parameter of node.parameters) {
          if (
            ts.isIdentifier(parameter.name) &&
            /(?:^|_)(?:module|generatedModule|workflowModule)(?:$|_)/i.test(parameter.name.text)
          ) {
            generatedModuleParameters.add(parameter.name.text);
          }
        }
      }
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer !== undefined &&
        dynamicGeneratedImport(node.initializer)
      ) {
        if (ts.isIdentifier(node.name)) moduleBindings.add(node.name.text);
        if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            if (ts.isIdentifier(element.name)) {
              workflowBindings.add(element.name.text);
            }
          }
        }
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        dynamicGeneratedImport(node.right)
      ) {
        const root = rootIdentifier(node.left);
        if (root !== undefined) moduleBindings.add(root);
      }
      ts.forEachChild(node, collectModules);
    };
    collectModules(source);

    const collectAliases = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
        const root = rootIdentifier(node.initializer);
        if (root !== undefined && moduleBindings.has(root)) {
          workflowBindings.add(node.name.text);
        }
      }
      ts.forEachChild(node, collectAliases);
    };
    collectAliases(source);

    const findCallers = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.arguments.length > 0 &&
        node.arguments.length < 3 &&
        isGeneratedExecuteArgument(node.arguments[0])
      ) {
        const callee = unwrap(node.expression);
        const root = rootIdentifier(callee);
        const isGeneratedCaller =
          (ts.isIdentifier(callee) && workflowBindings.has(callee.text)) ||
          (root !== undefined && (moduleBindings.has(root) || generatedModuleParameters.has(root)));
        if (isGeneratedCaller) {
          const location = source.getLineAndCharacterOfPosition(node.getStart(source));
          offenders.push(`${file}:${location.line + 1}:${location.character + 1}`);
        }
      }
      ts.forEachChild(node, findCallers);
    };
    findCallers(source);
  }
  return offenders;
}

describe('A2 clean-cutover removal inventory', () => {
  it('has no legacy gate, checkpoint, global ABI, or stale generated caller in shipped roots', () => {
    const shippedRoots = ['src/', 'fixtures/', 'use-cases/', 'docs/reference/', 'dist/'];
    const offenders = matchingFiles().filter((file) => shippedRoots.some((root) => file.startsWith(root)));
    expect(offenders).toEqual([]);
  });

  it('classifies every remaining tracked historical or negative-test match', () => {
    const unclassified = matchingFiles().filter(
      (file) =>
        !file.startsWith('tests/') &&
        file !== 'docs/stitch-a0-baseline.md' &&
        file !== 'docs/stitch-a2-continuation.md' &&
        file !== 'docs/adr/0001-durable-gate-continuation.md',
    );
    expect(unclassified).toEqual([]);
  });

  it('proves superseded production modules and generated approval strategies are absent', () => {
    for (const file of [
      'src/runtime/checkpoint.ts',
      'src/mcp/agent-channel.ts',
      'src/mcp/run-registry.ts',
      'src/cli/templates/approvals/index.ts',
      'src/runtime/precompiled-executor.ts',
      'src/sealed-bundle/index.ts',
    ]) {
      expect(fs.existsSync(path.join(repositoryRoot, file)), file).toBe(false);
    }
  });

  it('keeps Stitch transport, session, signing, and production execution outside Flow Weaver', () => {
    const shippedRoots = ['src/', 'fixtures/', 'use-cases/'];
    const offenders = trackedTextFiles()
      .filter((file) => shippedRoots.some((root) => file.startsWith(root)))
      .filter((file) => productionBoundaryPattern.test(
        fs.readFileSync(path.join(repositoryRoot, file), 'utf8'),
      ));
    expect(offenders).toEqual([]);
  });

  it('publishes artifact compilation without any public execution compatibility surface', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { exports?: Record<string, unknown> };

    expect(packageJson.exports?.['./compiler']).toEqual({
      types: './dist/compiler/index.d.ts',
      default: './dist/compiler/index.js',
    });
    expect(packageJson.exports).not.toHaveProperty('./executor');
    expect(packageJson.exports).not.toHaveProperty('./precompiled-executor');
    expect(packageJson.exports).not.toHaveProperty('./sealed-bundle');
  });

  it('requires an explicit runtime at every dynamically generated first-party caller', () => {
    expect(generatedCallerCutoverOffenders()).toEqual([]);
  });

  it('fails closed when a helper-mediated generated caller omits its runtime', () => {
    const helperMediatedLegacyCaller = `
      async function loadModule(filePath: string): Promise<Record<string, unknown>> {
        return import(filePath);
      }
      function executeGenerated(
        module: { testWorkflow: (...args: unknown[]) => unknown },
        execute: boolean,
        params: Record<string, unknown>,
      ) {
        return module.testWorkflow(execute, params);
      }
      async function callGenerated(path: string) {
        const module = await loadModule(path);
        return executeGenerated(module, true, {});
      }
    `;

    expect(
      generatedCallerCutoverOffenders([
        {
          file: 'tests/virtual/helper-mediated-generated-caller.test.ts',
          text: helperMediatedLegacyCaller,
        },
      ]),
    ).toContain('tests/virtual/helper-mediated-generated-caller.test.ts:10:16');
  });
});
