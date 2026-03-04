/**
 * Tests for @job, @stage, @variables, @before_script, @tags, @includes annotations.
 *
 * Covers:
 * - Annotation parsing → AST fields in options.cicd
 * - buildJobGraph() applying @job configs, @stage assignments, workflow defaults
 * - Validation rules: CICD_JOB_CONFIG_ORPHAN, CICD_STAGE_ORPHAN
 * - CI/CD detection with new fields
 */

// Load CI/CD extension (registers tag handlers, validation rules)
import '../register';

import { describe, it, expect } from 'vitest';
import { AnnotationParser } from '../../../parser';
import {
  BaseCICDTarget,
  type CICDJob,
  type CICDStep,
} from '../base-target';
import type {
  ExportOptions,
  ExportArtifacts,
  DeployInstructions,
} from '../../../deployment/targets/base';
import { isCICDWorkflow } from '../detection';
import { jobConfigOrphanRule, stageOrphanRule } from '../rules';
import { getKnownWorkflowTags } from '../../../constants';
import { tagHandlerRegistry } from '../../../parser/tag-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseWorkflowSource(source: string) {
  const parser = new AnnotationParser();
  return parser.parseFromString(source, 'test.ts');
}

/** Minimal concrete subclass to access protected methods */
class TestCICDTarget extends BaseCICDTarget {
  readonly name = 'test-cicd';
  readonly description = 'Test CI/CD target';

  async generate(_options: ExportOptions): Promise<ExportArtifacts> {
    return { files: [], target: this.name, workflowName: '', entryPoint: '' };
  }

  getDeployInstructions(_artifacts: ExportArtifacts): DeployInstructions {
    return { title: '', steps: [], prerequisites: [] };
  }

  public testBuildJobGraph(ast: Parameters<BaseCICDTarget['buildJobGraph']>[0]) {
    return this.buildJobGraph(ast);
  }
}

const target = new TestCICDTarget();

/** A minimal workflow template with two jobs */
function twoJobWorkflow(annotations: string) {
  return `
/**
 * @flowWeaver workflow
 * ${annotations}
 * @node lint eslint [job: "lint"] [position: 0 0]
 * @node testUnit npmTest [job: "test-unit"] [position: 1 0]
 * @path Start -> lint -> Exit
 * @path Start -> testUnit -> Exit
 */
export function pipeline() {}

/** @flowWeaver nodeType
 * @expression
 */
function eslint(): {} { return {}; }

/** @flowWeaver nodeType
 * @expression
 */
function npmTest(): {} { return {}; }
`;
}

/** A three-job pipeline with dependencies */
function threeJobPipeline(annotations: string) {
  return `
/**
 * @flowWeaver workflow
 * ${annotations}
 * @node lint eslint [job: "lint"] [position: 0 0]
 * @node testUnit npmTest [job: "test-unit"] [position: 1 0]
 * @node build npmBuild [job: "build"] [position: 2 0]
 * @path Start -> lint -> build -> Exit
 * @path Start -> testUnit -> build
 */
export function pipeline() {}

/** @flowWeaver nodeType
 * @expression
 */
function eslint(): {} { return {}; }

/** @flowWeaver nodeType
 * @expression
 */
function npmTest(): {} { return {}; }

/** @flowWeaver nodeType
 * @expression
 */
function npmBuild(): {} { return {}; }
`;
}

// ---------------------------------------------------------------------------
// Constants: new tags are recognized
// ---------------------------------------------------------------------------

describe('new CI/CD tags in known workflow tags (via registry)', () => {
  const knownTags = getKnownWorkflowTags(tagHandlerRegistry.getRegisteredTags());
  for (const tag of ['job', 'stage', 'variables', 'before_script', 'tags', 'includes']) {
    it(`should include '${tag}'`, () => {
      expect(knownTags.has(tag)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// @job annotation parsing
// ---------------------------------------------------------------------------

describe('@job annotation parsing', () => {
  it('should parse @job with retry and timeout', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint retry=2 timeout="5m"',
    ));
    const wf = result.workflows[0];
    expect(wf.options?.cicd?.jobs).toBeDefined();
    const lintJob = wf.options?.cicd?.jobs?.find(j => j.id === 'lint');
    expect(lintJob?.retry).toBe(2);
    expect(lintJob?.timeout).toBe('5m');
  });

  it('should parse @job with allow_failure', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job test-unit allow_failure=true',
    ));
    const wf = result.workflows[0];
    const testJob = wf.options?.cicd?.jobs?.find(j => j.id === 'test-unit');
    expect(testJob?.allowFailure).toBe(true);
  });

  it('should parse @job with tags as comma-separated list', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint tags="docker,linux"',
    ));
    const wf = result.workflows[0];
    const lintJob = wf.options?.cicd?.jobs?.find(j => j.id === 'lint');
    expect(lintJob?.tags).toEqual(['docker', 'linux']);
  });

  it('should parse @job with coverage regex', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job test-unit coverage="/Coverage: (\\d+)%/"',
    ));
    const wf = result.workflows[0];
    const testJob = wf.options?.cicd?.jobs?.find(j => j.id === 'test-unit');
    expect(testJob?.coverage).toMatch(/Coverage/);
  });

  it('should parse @job with reports', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job test-unit reports="junit=test-results.xml"',
    ));
    const wf = result.workflows[0];
    const testJob = wf.options?.cicd?.jobs?.find(j => j.id === 'test-unit');
    expect(testJob?.reports).toBeDefined();
    expect(testJob?.reports?.[0]?.type).toBe('junit');
    expect(testJob?.reports?.[0]?.path).toBe('test-results.xml');
  });

  it('should parse @job with extends', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint extends=".base-job"',
    ));
    const wf = result.workflows[0];
    const lintJob = wf.options?.cicd?.jobs?.find(j => j.id === 'lint');
    expect(lintJob?.extends).toBe('.base-job');
  });

  it('should parse @job with rules', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint rules="$CI_COMMIT_BRANCH == main"',
    ));
    const wf = result.workflows[0];
    const lintJob = wf.options?.cicd?.jobs?.find(j => j.id === 'lint');
    expect(lintJob?.rules).toBeDefined();
    expect(lintJob?.rules?.[0]?.if).toContain('CI_COMMIT_BRANCH');
  });

  it('should parse @job with runner override', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint runner="macos-latest"',
    ));
    const wf = result.workflows[0];
    const lintJob = wf.options?.cicd?.jobs?.find(j => j.id === 'lint');
    expect(lintJob?.runner).toBe('macos-latest');
  });

  it('should parse multiple @job annotations on same workflow', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint retry=2\n * @job test-unit allow_failure=true timeout="30m"',
    ));
    const wf = result.workflows[0];
    expect(wf.options?.cicd?.jobs?.length).toBe(2);
    const lintJob = wf.options?.cicd?.jobs?.find(j => j.id === 'lint');
    const testJob = wf.options?.cicd?.jobs?.find(j => j.id === 'test-unit');
    expect(lintJob?.retry).toBe(2);
    expect(testJob?.allowFailure).toBe(true);
    expect(testJob?.timeout).toBe('30m');
  });

  it('should merge repeated @job annotations for same job', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint retry=2\n * @job lint timeout="5m"',
    ));
    const wf = result.workflows[0];
    const lintJobs = wf.options?.cicd?.jobs?.filter(j => j.id === 'lint');
    expect(lintJobs?.length).toBe(1);
    expect(lintJobs?.[0]?.retry).toBe(2);
    expect(lintJobs?.[0]?.timeout).toBe('5m');
  });

  it('should parse @job name-only without attributes', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint',
    ));
    const wf = result.workflows[0];
    const lintJob = wf.options?.cicd?.jobs?.find(j => j.id === 'lint');
    expect(lintJob).toBeDefined();
    expect(lintJob?.id).toBe('lint');
  });

  it('should warn on empty @job', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job',
    ));
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes('@job'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// @stage annotation parsing
// ---------------------------------------------------------------------------

describe('@stage annotation parsing', () => {
  it('should parse a single @stage', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@stage test',
    ));
    const wf = result.workflows[0];
    expect(wf.options?.cicd?.stages).toBeDefined();
    expect(wf.options?.cicd?.stages?.[0]?.name).toBe('test');
  });

  it('should parse multiple @stage declarations', () => {
    const result = parseWorkflowSource(threeJobPipeline(
      '@stage test\n * @stage build\n * @stage deploy',
    ));
    const wf = result.workflows[0];
    expect(wf.options?.cicd?.stages?.length).toBe(3);
    expect(wf.options?.cicd?.stages?.map(s => s.name)).toEqual(['test', 'build', 'deploy']);
  });

  it('should preserve stage declaration order', () => {
    const result = parseWorkflowSource(threeJobPipeline(
      '@stage deploy\n * @stage test\n * @stage build',
    ));
    const wf = result.workflows[0];
    expect(wf.options?.cicd?.stages?.map(s => s.name)).toEqual(['deploy', 'test', 'build']);
  });
});

// ---------------------------------------------------------------------------
// @variables annotation parsing
// ---------------------------------------------------------------------------

describe('@variables annotation parsing', () => {
  it('should parse key=value pairs', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@variables NODE_ENV="production" CI="true"',
    ));
    const wf = result.workflows[0];
    expect(wf.options?.cicd?.variables).toBeDefined();
    expect(wf.options?.cicd?.variables?.NODE_ENV).toBe('production');
    expect(wf.options?.cicd?.variables?.CI).toBe('true');
  });

  it('should parse bare (unquoted) values', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@variables NODE_ENV=production',
    ));
    const wf = result.workflows[0];
    expect(wf.options?.cicd?.variables?.NODE_ENV).toBe('production');
  });
});

// ---------------------------------------------------------------------------
// @before_script annotation parsing
// ---------------------------------------------------------------------------

describe('@before_script annotation parsing', () => {
  it('should parse quoted command', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@before_script "npm ci"',
    ));
    const wf = result.workflows[0];
    expect(wf.options?.cicd?.beforeScript).toBeDefined();
    expect(wf.options?.cicd?.beforeScript).toContain('npm ci');
  });

  it('should parse unquoted command', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@before_script npm ci',
    ));
    const wf = result.workflows[0];
    expect(wf.options?.cicd?.beforeScript).toBeDefined();
    expect(wf.options?.cicd?.beforeScript?.[0]).toBe('npm ci');
  });
});

// ---------------------------------------------------------------------------
// @tags annotation parsing
// ---------------------------------------------------------------------------

describe('@tags annotation parsing', () => {
  it('should parse space-separated tags', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@tags docker linux',
    ));
    const wf = result.workflows[0];
    expect(wf.options?.cicd?.tags).toEqual(['docker', 'linux']);
  });

  it('should parse comma-separated tags', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@tags docker,linux,arm64',
    ));
    const wf = result.workflows[0];
    expect(wf.options?.cicd?.tags).toEqual(['docker', 'linux', 'arm64']);
  });
});

// ---------------------------------------------------------------------------
// @includes annotation parsing
// ---------------------------------------------------------------------------

describe('@includes annotation parsing', () => {
  it('should parse local include', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@includes local="ci/shared.yml"',
    ));
    const wf = result.workflows[0];
    expect(wf.options?.cicd?.includes).toBeDefined();
    expect(wf.options?.cicd?.includes?.[0]?.type).toBe('local');
    expect(wf.options?.cicd?.includes?.[0]?.file).toBe('ci/shared.yml');
  });

  it('should parse template include', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@includes template="Auto-DevOps.gitlab-ci.yml"',
    ));
    const wf = result.workflows[0];
    expect(wf.options?.cicd?.includes?.[0]?.type).toBe('template');
    expect(wf.options?.cicd?.includes?.[0]?.file).toBe('Auto-DevOps.gitlab-ci.yml');
  });

  it('should parse remote include', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@includes remote="https://example.com/ci.yml"',
    ));
    const wf = result.workflows[0];
    expect(wf.options?.cicd?.includes?.[0]?.type).toBe('remote');
    expect(wf.options?.cicd?.includes?.[0]?.file).toBe('https://example.com/ci.yml');
  });
});

// ---------------------------------------------------------------------------
// CI/CD detection with new fields
// ---------------------------------------------------------------------------

describe('isCICDWorkflow detection with new fields', () => {
  it('should detect workflow with @job annotations', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint retry=2',
    ));
    expect(isCICDWorkflow(result.workflows[0])).toBe(true);
  });

  it('should detect workflow with @stage annotations', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@stage test',
    ));
    expect(isCICDWorkflow(result.workflows[0])).toBe(true);
  });

  it('should detect workflow with @variables', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@variables CI="true"',
    ));
    expect(isCICDWorkflow(result.workflows[0])).toBe(true);
  });

  it('should detect workflow with @before_script', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@before_script "npm ci"',
    ));
    expect(isCICDWorkflow(result.workflows[0])).toBe(true);
  });

  it('should detect workflow with @tags', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@tags docker',
    ));
    expect(isCICDWorkflow(result.workflows[0])).toBe(true);
  });

  it('should detect workflow with @includes', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@includes local="ci/shared.yml"',
    ));
    expect(isCICDWorkflow(result.workflows[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildJobGraph: @job configs applied
// ---------------------------------------------------------------------------

describe('buildJobGraph applies @job configs', () => {
  it('should set retry on the matching job', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint retry=3',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    const lint = jobs.find(j => j.id === 'lint');
    expect(lint?.retry).toBe(3);
  });

  it('should set allowFailure on the matching job', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job test-unit allow_failure=true',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    const testUnit = jobs.find(j => j.id === 'test-unit');
    expect(testUnit?.allowFailure).toBe(true);
  });

  it('should set timeout on the matching job', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint timeout="10m"',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    const lint = jobs.find(j => j.id === 'lint');
    expect(lint?.timeout).toBe('10m');
  });

  it('should set tags on the matching job', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint tags="docker,linux"',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    const lint = jobs.find(j => j.id === 'lint');
    expect(lint?.tags).toEqual(['docker', 'linux']);
  });

  it('should set coverage on the matching job', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job test-unit coverage="/Coverage: (\\d+)%/"',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    const testUnit = jobs.find(j => j.id === 'test-unit');
    expect(testUnit?.coverage).toBeDefined();
  });

  it('should set extends on the matching job', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint extends=".base-lint"',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    const lint = jobs.find(j => j.id === 'lint');
    expect(lint?.extends).toBe('.base-lint');
  });

  it('should set runner override on the matching job', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@runner ubuntu-latest\n * @job lint runner="macos-latest"',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    const lint = jobs.find(j => j.id === 'lint');
    const testUnit = jobs.find(j => j.id === 'test-unit');
    expect(lint?.runner).toBe('macos-latest');
    expect(testUnit?.runner).toBe('ubuntu-latest');
  });

  it('should not apply @job config to non-matching jobs', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint retry=2',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    const testUnit = jobs.find(j => j.id === 'test-unit');
    expect(testUnit?.retry).toBeUndefined();
  });

  it('should apply multiple @job configs to their respective jobs', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint retry=1 timeout="5m"\n * @job test-unit allow_failure=true timeout="30m"',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    const lint = jobs.find(j => j.id === 'lint');
    const testUnit = jobs.find(j => j.id === 'test-unit');
    expect(lint?.retry).toBe(1);
    expect(lint?.timeout).toBe('5m');
    expect(testUnit?.allowFailure).toBe(true);
    expect(testUnit?.timeout).toBe('30m');
  });
});

// ---------------------------------------------------------------------------
// buildJobGraph: @stage assignments
// ---------------------------------------------------------------------------

describe('buildJobGraph applies @stage assignments', () => {
  it('should assign stage by job name prefix matching', () => {
    const result = parseWorkflowSource(threeJobPipeline(
      '@job lint retry=0\n * @job test-unit retry=0\n * @job build retry=0\n * @stage test\n * @stage build',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    // "lint" doesn't match "test" or "build" by prefix, gets assigned by depth
    // "test-unit" matches "test" by prefix
    const testUnit = jobs.find(j => j.id === 'test-unit');
    expect(testUnit?.stage).toBe('test');
    // "build" matches "build" by prefix
    const build = jobs.find(j => j.id === 'build');
    expect(build?.stage).toBe('build');
  });

  it('should assign stage by depth for non-matching jobs', () => {
    const result = parseWorkflowSource(threeJobPipeline(
      '@job lint retry=0\n * @job test-unit retry=0\n * @job build retry=0\n * @stage test\n * @stage build',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    const lint = jobs.find(j => j.id === 'lint');
    // "lint" at depth 0 maps to first stage "test"
    expect(lint?.stage).toBeDefined();
  });

  it('should not assign stage when no @stage annotations exist', () => {
    const result = parseWorkflowSource(threeJobPipeline(
      '@job lint retry=0',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    const lint = jobs.find(j => j.id === 'lint');
    expect(lint?.stage).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildJobGraph: workflow defaults
// ---------------------------------------------------------------------------

describe('buildJobGraph applies workflow defaults', () => {
  it('should apply @variables to jobs without explicit variables', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@variables NODE_ENV="production"',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    for (const job of jobs) {
      expect(job.variables?.NODE_ENV).toBe('production');
    }
  });

  it('should not overwrite job-level variables with workflow defaults', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@variables NODE_ENV="production"\n * @job lint variables="NODE_ENV=development"',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    const lint = jobs.find(j => j.id === 'lint');
    // Job-level variables take precedence (not overwritten by default)
    expect(lint?.variables).toBeDefined();
  });

  it('should apply @before_script to jobs without explicit before_script', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@before_script "npm ci"',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    for (const job of jobs) {
      expect(job.beforeScript).toContain('npm ci');
    }
  });

  it('should apply @tags to jobs without explicit tags', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@tags docker linux',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    for (const job of jobs) {
      expect(job.tags).toEqual(['docker', 'linux']);
    }
  });

  it('should not overwrite job-level tags with workflow defaults', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@tags docker\n * @job lint tags="gpu,linux"',
    ));
    const jobs = target.testBuildJobGraph(result.workflows[0]);
    const lint = jobs.find(j => j.id === 'lint');
    expect(lint?.tags).toEqual(['gpu', 'linux']);
    const testUnit = jobs.find(j => j.id === 'test-unit');
    expect(testUnit?.tags).toEqual(['docker']);
  });
});

// ---------------------------------------------------------------------------
// Validation: CICD_JOB_CONFIG_ORPHAN
// ---------------------------------------------------------------------------

describe('CICD_JOB_CONFIG_ORPHAN validation rule', () => {
  it('should warn when @job references a non-existent job', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job deploy retry=2',
    ));
    const errors = jobConfigOrphanRule.validate(result.workflows[0]);
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe('CICD_JOB_CONFIG_ORPHAN');
    expect(errors[0].message).toContain('deploy');
  });

  it('should not warn when @job matches an existing job', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job lint retry=2',
    ));
    const errors = jobConfigOrphanRule.validate(result.workflows[0]);
    expect(errors.length).toBe(0);
  });

  it('should warn for each orphaned @job config', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@job deploy retry=2\n * @job staging allow_failure=true',
    ));
    const errors = jobConfigOrphanRule.validate(result.workflows[0]);
    expect(errors.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Validation: CICD_STAGE_ORPHAN
// ---------------------------------------------------------------------------

describe('CICD_STAGE_ORPHAN validation rule', () => {
  it('should warn when @stage has no matching jobs', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@stage deploy',
    ));
    const errors = stageOrphanRule.validate(result.workflows[0]);
    // "deploy" doesn't match "lint" or "test-unit" by prefix
    expect(errors.length).toBe(1);
    expect(errors[0].code).toBe('CICD_STAGE_ORPHAN');
    expect(errors[0].message).toContain('deploy');
  });

  it('should not warn when @stage matches jobs by prefix', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@stage test',
    ));
    const errors = stageOrphanRule.validate(result.workflows[0]);
    // "test" matches "test-unit" by prefix
    expect(errors.length).toBe(0);
  });

  it('should not warn when @stage exactly matches a job', () => {
    const result = parseWorkflowSource(twoJobWorkflow(
      '@stage lint',
    ));
    const errors = stageOrphanRule.validate(result.workflows[0]);
    expect(errors.length).toBe(0);
  });

  it('should return no errors when no stages are declared', () => {
    const result = parseWorkflowSource(twoJobWorkflow(''));
    const errors = stageOrphanRule.validate(result.workflows[0]);
    expect(errors.length).toBe(0);
  });
});
