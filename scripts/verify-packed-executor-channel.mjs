#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageName = '@synergenius/flow-weaver';
const executorChannelSubpath = './executor-channel';
const requiredRuntimeExports = Object.freeze([
  'DurableReplayLedger',
  'ExecutorCorrelationLedger',
  'ExecutorSessionMachine',
  'InboundReplayCursor',
  'acceptExecutorChannelLimits',
  'assertExecutorChannelDirection',
  'canonicalExecutorChannelMessage',
  'canonicalExecutorChannelWireValue',
  'decodeExecutorChannelFrame',
  'encodeExecutorChannelFrame',
  'negotiateExecutorChannelLimits',
  'EXECUTOR_CHANNEL_FORMAT_1_LIMITS',
]);

function fail(message) {
  throw new Error(`Packed executor-channel verification failed: ${message}`);
}

function acceptExportTarget(value, field) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('./dist/executor-channel/') ||
    value.includes('\\') ||
    value.split('/').includes('..')
  ) {
    fail(
      `${executorChannelSubpath}.${field} is not a closed executor-channel target`,
    );
  }
  return value;
}

function assertInstalledTarget(packageRoot, target, field) {
  const absoluteTarget = resolve(packageRoot, target);
  const packageRelativeTarget = relative(packageRoot, absoluteTarget);
  if (
    packageRelativeTarget.startsWith('..') ||
    isAbsolute(packageRelativeTarget) ||
    !existsSync(absoluteTarget)
  ) {
    fail(
      `${executorChannelSubpath}.${field} target is absent from the installed tarball`,
    );
  }
}

const tarballArgument = process.argv[2];
if (tarballArgument === undefined || process.argv.length !== 3) {
  fail('usage: node scripts/verify-packed-executor-channel.mjs <tarball>');
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tarballPath = resolve(repositoryRoot, tarballArgument);
if (!existsSync(tarballPath)) {
  fail(`tarball does not exist: ${tarballPath}`);
}

const verificationRoot = mkdtempSync(
  join(tmpdir(), 'flow-weaver-packed-executor-channel-'),
);

try {
  writeFileSync(
    join(verificationRoot, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
  );
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const installation = spawnSync(
    npmCommand,
    [
      'install',
      '--ignore-scripts=false',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--save=false',
      tarballPath,
    ],
    {
      cwd: verificationRoot,
      encoding: 'utf8',
      timeout: 120_000,
    },
  );
  if (installation.status !== 0) {
    fail(
      [
        'npm could not install the exact tarball with lifecycle scripts enabled',
        installation.error?.message,
        installation.signal === null
          ? undefined
          : `npm terminated with signal ${installation.signal}`,
        installation.stderr?.trim(),
        installation.stdout?.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  const packageRoot = join(
    verificationRoot,
    'node_modules',
    '@synergenius',
    'flow-weaver',
  );
  const packageJsonPath = join(packageRoot, 'package.json');
  if (!existsSync(packageJsonPath)) {
    fail('installed tarball has no package.json');
  }

  const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (manifest.name !== packageName) {
    fail(`expected ${packageName}, received ${String(manifest.name)}`);
  }
  if (
    Object.values(manifest.scripts ?? {}).some(
      (command) =>
        typeof command === 'string' &&
        command.includes('scripts/check-npm-auth.mjs'),
    )
  ) {
    fail(
      'published package must not reference the repository authentication helper',
    );
  }

  const executorChannelExport = manifest.exports?.[executorChannelSubpath];
  if (
    executorChannelExport === null ||
    typeof executorChannelExport !== 'object' ||
    Array.isArray(executorChannelExport)
  ) {
    fail(`${executorChannelSubpath} is not an explicit conditional export`);
  }

  const typeTarget = acceptExportTarget(executorChannelExport.types, 'types');
  const runtimeTarget = acceptExportTarget(
    executorChannelExport.default,
    'default',
  );
  assertInstalledTarget(packageRoot, typeTarget, 'types');
  assertInstalledTarget(packageRoot, runtimeTarget, 'default');

  const typeScriptConsumer = `
    import { compileWorkflow } from ${JSON.stringify(packageName)};
    import {
      DurableReplayLedger,
      ExecutorCorrelationLedger,
      ExecutorSessionMachine,
      InboundReplayCursor,
      acceptExecutorChannelLimits,
      assertExecutorChannelDirection,
      canonicalExecutorChannelMessage,
      canonicalExecutorChannelWireValue,
      decodeExecutorChannelFrame,
      encodeExecutorChannelFrame,
      negotiateExecutorChannelLimits,
      EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
      type DurableReplayLedgerSnapshot,
      type ExecutorChannelDirection,
      type ExecutorChannelFrame,
      type ExecutorChannelLimits,
      type ExecutorCorrelationLedgerSnapshot,
      type ExecutorSessionSnapshot,
      type InboundReplayCursorSnapshot,
    } from ${JSON.stringify(`${packageName}/executor-channel`)};

    export const stitchRuntimeImports = {
      compileWorkflow,
      DurableReplayLedger,
      ExecutorCorrelationLedger,
      ExecutorSessionMachine,
      InboundReplayCursor,
      acceptExecutorChannelLimits,
      assertExecutorChannelDirection,
      canonicalExecutorChannelMessage,
      canonicalExecutorChannelWireValue,
      decodeExecutorChannelFrame,
      encodeExecutorChannelFrame,
      negotiateExecutorChannelLimits,
      EXECUTOR_CHANNEL_FORMAT_1_LIMITS,
    };

    export type StitchExecutorChannelTypes = {
      replay: DurableReplayLedgerSnapshot;
      direction: ExecutorChannelDirection;
      frame: ExecutorChannelFrame;
      limits: ExecutorChannelLimits;
      correlation: ExecutorCorrelationLedgerSnapshot;
      session: ExecutorSessionSnapshot;
      inbound: InboundReplayCursorSnapshot;
    };
  `;
  writeFileSync(
    join(verificationRoot, 'consumer.ts'),
    typeScriptConsumer.trimStart(),
  );
  writeFileSync(
    join(verificationRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        include: ['consumer.ts'],
      },
      null,
      2,
    )}\n`,
  );

  const typeScriptCli = join(
    verificationRoot,
    'node_modules',
    'typescript',
    'bin',
    'tsc',
  );
  if (!existsSync(typeScriptCli)) {
    fail('npm did not install the declared TypeScript peer dependency');
  }
  const typeProbe = spawnSync(
    process.execPath,
    [typeScriptCli, '--project', join(verificationRoot, 'tsconfig.json')],
    {
      cwd: verificationRoot,
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  if (typeProbe.status !== 0) {
    fail(
      [
        'strict NodeNext consumer could not typecheck the installed tarball',
        typeProbe.error?.message,
        typeProbe.signal === null
          ? undefined
          : `TypeScript terminated with signal ${typeProbe.signal}`,
        typeProbe.stderr?.trim(),
        typeProbe.stdout?.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  const importProbe = `
    const root = await import(${JSON.stringify(packageName)});
    if (!('compileWorkflow' in root)) {
      throw new Error('missing root runtime export: compileWorkflow');
    }
    const channel = await import(${JSON.stringify(
      `${packageName}/executor-channel`,
    )});
    const required = ${JSON.stringify(requiredRuntimeExports)};
    for (const name of required) {
      if (!(name in channel)) {
        throw new Error(\`missing executor-channel runtime export: \${name}\`);
      }
    }
  `;
  const probe = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', importProbe],
    {
      cwd: verificationRoot,
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  if (probe.status !== 0) {
    fail(
      [
        `Node could not import ${packageName}/executor-channel`,
        probe.error?.message,
        probe.signal === null
          ? undefined
          : `Node terminated with signal ${probe.signal}`,
        probe.stderr?.trim(),
        probe.stdout?.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  console.log(
    `Verified packed ${packageName} lifecycle, NodeNext types, root import, and executor-channel import.`,
  );
} finally {
  rmSync(verificationRoot, { recursive: true, force: true });
}
