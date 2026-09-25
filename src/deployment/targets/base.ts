/**
 * Base export target interface and abstract class
 *
 * Defines the contract for export targets (provided by packs) and provides
 * shared utilities for generating deployment artifacts.
 */

import * as path from 'path';
import { getGeneratedBranding } from '../../generated-branding.js';
import {
  FUNCTION_REFERENCE_SCHEMA,
  TAGS,
  functionsEndpoint,
  nodeTypeOperation,
  openApiDocument,
  specEndpoint,
  workflowOperation,
} from './openapi-parts.js';

/**
 * Export options passed to targets
 */
export interface ExportOptions {
  /** Path to the workflow source file */
  sourceFile: string;
  /** Workflow function name */
  workflowName: string;
  /** Workflow display name */
  displayName: string;
  /** Output directory */
  outputDir: string;
  /** Workflow description */
  description?: string;
  /** Production mode (no trace events) */
  production?: boolean;
  /** Include API documentation routes (/docs and /openapi.json) */
  includeDocs?: boolean;
  /** Additional target-specific options */
  targetOptions?: Record<string, unknown>;
  /** Export all workflows in file as a single service */
  multi?: boolean;
  /** Specific workflow names to export (subset of file) */
  workflows?: string[];
}

/**
 * Compiled workflow metadata for multi-workflow export
 */
export interface CompiledWorkflow {
  /** Workflow name (used in URL path) */
  name: string;
  /** Function name in compiled code */
  functionName: string;
  /** Workflow description */
  description?: string;
  /** Compiled code content */
  code?: string;
}

/**
 * A single generated file
 */
export interface GeneratedFile {
  /** Relative path from output directory */
  relativePath: string;
  /** Absolute path */
  absolutePath: string;
  /** File content */
  content: string;
  /** File type for display */
  type: 'handler' | 'config' | 'workflow' | 'nodeType' | 'package' | 'other';
}

/**
 * Export result with all generated artifacts
 */
export interface ExportArtifacts {
  /** Generated files */
  files: GeneratedFile[];
  /** Target name */
  target: string;
  /** Workflow name */
  workflowName: string;
  /** Entry point file */
  entryPoint: string;
  /** Warnings about unsupported or dropped annotations */
  warnings?: string[];
}

/**
 * Deployment instructions
 */
export interface DeployInstructions {
  /** Title for the instructions */
  title: string;
  /** Step-by-step instructions */
  steps: string[];
  /** Required tools/dependencies */
  prerequisites: string[];
  /** Steps to test locally before deploying */
  localTestSteps?: string[];
  /** Links to documentation */
  links?: { label: string; url: string }[];
}

/**
 * Multi-workflow export artifacts
 */
export interface MultiWorkflowArtifacts extends ExportArtifacts {
  /** All workflow names included */
  workflowNames: string[];
  /** OpenAPI spec if generated */
  openApiSpec?: object;
}

/**
 * Node type export options
 */
export interface NodeTypeExportOptions {
  /** Source file path */
  sourceFile: string;
  /** Service name for the exported handlers */
  serviceName: string;
  /** Output directory */
  outputDir: string;
  /** Production mode (no trace events) */
  production?: boolean;
  /** Include API documentation routes */
  includeDocs?: boolean;
}

/**
 * Node type export artifacts
 */
export interface NodeTypeArtifacts extends ExportArtifacts {
  /** All node type names included */
  nodeTypeNames: string[];
  /** OpenAPI spec if generated */
  openApiSpec?: object;
}

/**
 * Node type info for export (matches TNodeTypeAST structure)
 */
export interface NodeTypeInfo {
  name: string;
  functionName: string;
  description?: string;
  inputs: Record<
    string,
    { dataType?: string; tsType?: string; label?: string; optional?: boolean }
  >;
  outputs: Record<string, { dataType?: string; tsType?: string; label?: string }>;
  /** Generated wrapper code for standalone deployment */
  code?: string;
}

/**
 * Bundle item with expose flag - used for unified bundle export
 *
 * Key concepts:
 * - bundled items are included in the export
 * - exposed items get HTTP endpoints
 * - non-exposed bundled items are available as internal dependencies
 */
export interface BundleWorkflow extends CompiledWorkflow {
  /** Whether to create HTTP endpoint for this workflow */
  expose: boolean;
}

export interface BundleNodeType extends NodeTypeInfo {
  /** Whether to create HTTP endpoint for this node type */
  expose: boolean;
  /** Generated wrapper code for standalone deployment */
  code?: string;
}

/**
 * Bundle export artifacts
 */
export interface BundleArtifacts extends ExportArtifacts {
  /** All workflow names included */
  workflowNames?: string[];
  /** All node type names included */
  nodeTypeNames?: string[];
  /** OpenAPI spec if generated */
  openApiSpec?: object;
}

/**
 * Deploy schema field definition.
 * Describes a single key that a target accepts via @deploy annotations.
 */
export interface DeploySchemaField {
  type: 'string' | 'number' | 'boolean' | 'string[]';
  description: string;
  default?: unknown;
}

/**
 * Deploy schema: describes all @deploy keys a target accepts.
 * Used for validation, Studio autocomplete, and documentation.
 */
export type DeploySchema = Record<string, DeploySchemaField>;

/**
 * Export target interface
 */
export interface ExportTarget {
  /** Target identifier */
  readonly name: string;
  /** Human-readable description */
  readonly description: string;

  /** Schema for @deploy keys this target accepts on workflows */
  readonly deploySchema?: DeploySchema;

  /** Schema for @deploy keys this target accepts on node types */
  readonly nodeTypeDeploySchema?: DeploySchema;

  /**
   * Generate deployment artifacts for single workflow
   */
  generate(options: ExportOptions): Promise<ExportArtifacts>;

  /**
   * Generate deployment artifacts for multiple workflows
   */
  generateMultiWorkflow?(
    workflows: CompiledWorkflow[],
    options: ExportOptions
  ): Promise<MultiWorkflowArtifacts>;

  /**
   * Generate deployment artifacts for node types as standalone HTTP endpoints
   */
  generateNodeTypeService?(
    nodeTypes: NodeTypeInfo[],
    options: NodeTypeExportOptions
  ): Promise<NodeTypeArtifacts>;

  /**
   * Generate deployment artifacts for a unified bundle of workflows and node types.
   * Supports mixed content with individual expose flags for each item.
   *
   * @param workflows - Workflows to include, with expose flags
   * @param nodeTypes - Node types to include, with expose flags
   * @param options - Export options
   * @returns Bundle artifacts including files and metadata
   */
  generateBundle?(
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[],
    options: ExportOptions
  ): Promise<BundleArtifacts>;

  /**
   * Get deployment instructions
   */
  getDeployInstructions(artifacts: ExportArtifacts): DeployInstructions;
}

/**
 * Base export target with shared utilities
 */
export abstract class BaseExportTarget implements ExportTarget {
  abstract readonly name: string;
  abstract readonly description: string;

  abstract generate(options: ExportOptions): Promise<ExportArtifacts>;

  abstract generateMultiWorkflow(
    workflows: CompiledWorkflow[],
    options: ExportOptions
  ): Promise<MultiWorkflowArtifacts>;

  abstract generateNodeTypeService(
    nodeTypes: NodeTypeInfo[],
    options: NodeTypeExportOptions
  ): Promise<NodeTypeArtifacts>;

  abstract generateBundle(
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[],
    options: ExportOptions
  ): Promise<BundleArtifacts>;

  abstract getDeployInstructions(artifacts: ExportArtifacts): DeployInstructions;

  /**
   * Generate a standard package.json
   */
  protected generatePackageJson(options: {
    name: string;
    description?: string;
    main?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }): string {
    const pkg = {
      name: `fw-${options.name}`,
      version: '1.0.0',
      description: options.description || `Flow Weaver workflow: ${options.name}`,
      type: 'module',
      main: options.main || 'index.js',
      scripts: options.scripts || {},
      dependencies: options.dependencies || {},
      devDependencies: {
        typescript: '^5.0.0',
        ...options.devDependencies,
      },
    };

    return JSON.stringify(pkg, null, 2);
  }

  /**
   * Generate a standard tsconfig.json
   */
  protected generateTsConfig(
    options: {
      outDir?: string;
      module?: string;
      moduleResolution?: string;
      types?: string[];
    } = {}
  ): string {
    const config = {
      compilerOptions: {
        target: 'ES2022',
        module: options.module || 'NodeNext',
        moduleResolution: options.moduleResolution || 'NodeNext',
        outDir: options.outDir || './dist',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        ...(options.types && { types: options.types }),
      },
      include: ['**/*.ts'],
    };

    return JSON.stringify(config, null, 2);
  }

  /**
   * Create a file object
   */
  protected createFile(
    outputDir: string,
    relativePath: string,
    content: string,
    type: GeneratedFile['type']
  ): GeneratedFile {
    return {
      relativePath,
      absolutePath: path.join(outputDir, relativePath),
      content,
      type,
    };
  }

  /**
   * Generate content files for workflows and node types in a bundle.
   * Creates files under workflows/ and node-types/ subdirectories.
   */
  protected generateBundleContentFiles(
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[],
    outputDir: string,
    workflowDir = 'workflows',
    nodeTypeDir = 'node-types'
  ): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    for (const w of workflows) {
      if (w.code) {
        files.push(this.createFile(outputDir, `${workflowDir}/${w.name}.ts`, w.code, 'workflow'));
      }
    }
    for (const nt of nodeTypes) {
      if (nt.code) {
        // Use lowercase functionName for file naming to ensure consistency with import paths
        // and avoid case-sensitivity issues on case-insensitive filesystems (macOS, Windows)
        files.push(this.createFile(outputDir, `${nodeTypeDir}/${nt.functionName.toLowerCase()}.ts`, nt.code, 'nodeType'));
      }
    }
    return files;
  }

  /**
   * Generate content files for compiled workflows.
   * Creates files under the workflows/ subdirectory.
   */
  protected generateWorkflowContentFiles(
    workflows: CompiledWorkflow[],
    outputDir: string,
    workflowDir = 'workflows'
  ): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    for (const w of workflows) {
      if (w.code) {
        files.push(this.createFile(outputDir, `${workflowDir}/${w.name}.ts`, w.code, 'workflow'));
      }
    }
    return files;
  }

  /**
   * Generate content files for node types.
   * Creates files under the node-types/ subdirectory.
   */
  protected generateNodeTypeContentFiles(
    nodeTypes: NodeTypeInfo[],
    outputDir: string,
    nodeTypeDir = 'node-types'
  ): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    for (const nt of nodeTypes) {
      if (nt.code) {
        // Use lowercase functionName for file naming to ensure consistency with import paths
        // and avoid case-sensitivity issues on case-insensitive filesystems
        files.push(this.createFile(outputDir, `${nodeTypeDir}/${nt.functionName.toLowerCase()}.ts`, nt.code, 'nodeType'));
      }
    }
    return files;
  }

  /**
   * Get relative import path for the workflow
   */
  protected getWorkflowImport(workflowFile: string): string {
    const basename = path.basename(workflowFile, path.extname(workflowFile));
    return `./${basename}.js`;
  }

  /**
   * The OpenAPI document of a node-type service: one POST per node type.
   */
  protected generateNodeTypeOpenAPI(
    nodeTypes: NodeTypeInfo[],
    options: { title: string; version: string; baseUrl?: string }
  ): object {
    const paths: Record<string, object> = {};
    for (const nodeType of nodeTypes) {
      paths[`/api/${nodeType.name}`] = nodeTypeOperation(nodeType, `execute_${nodeType.functionName}`);
    }
    paths['/api/openapi.json'] = specEndpoint();
    return openApiDocument({
      ...options,
      description: `Node type service with ${nodeTypes.length} endpoints`,
      paths,
      tags: [TAGS.nodeTypes, TAGS.documentation],
    });
  }

  /**
   * The OpenAPI document of a multi-workflow service: one POST per workflow,
   * plus the function registry.
   */
  protected generateConsolidatedOpenAPI(
    workflows: CompiledWorkflow[],
    options: { title: string; version: string; baseUrl?: string }
  ): object {
    const paths: Record<string, object> = {};
    for (const workflow of workflows) {
      paths[`/api/${workflow.name}`] = workflowOperation(
        workflow,
        `execute_${workflow.functionName}`,
        'Workflow-specific parameters. Function parameters can be registry IDs.'
      );
    }
    paths['/api/functions'] = functionsEndpoint();
    paths['/api/openapi.json'] = specEndpoint();
    return openApiDocument({
      ...options,
      description: `Multi-workflow service with ${workflows.length} workflows`,
      paths,
      tags: [TAGS.workflows, TAGS.functions, TAGS.documentation],
      components: { schemas: { FunctionReference: FUNCTION_REFERENCE_SCHEMA } },
    });
  }

  /**
   * The OpenAPI document of a bundle: a POST for each exposed workflow and
   * node type, plus the function registry.
   */
  protected generateBundleOpenAPI(
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[],
    options: { title: string; version: string; baseUrl?: string }
  ): object {
    const exposedWorkflows = workflows.filter((w) => w.expose);
    const exposedNodeTypes = nodeTypes.filter((nt) => nt.expose);
    const paths: Record<string, object> = {};
    const tags: Array<{ name: string; description: string }> = [];

    if (exposedWorkflows.length > 0) tags.push(TAGS.workflows);
    for (const workflow of exposedWorkflows) {
      paths[`/api/workflows/${workflow.name}`] = workflowOperation(
        workflow,
        `execute_workflow_${workflow.functionName}`,
        'Workflow-specific parameters'
      );
    }
    if (exposedNodeTypes.length > 0) tags.push(TAGS.nodeTypes);
    for (const nodeType of exposedNodeTypes) {
      paths[`/api/nodes/${nodeType.name}`] = nodeTypeOperation(nodeType, `execute_node_${nodeType.functionName}`);
    }
    paths['/api/functions'] = functionsEndpoint();
    paths['/api/openapi.json'] = specEndpoint();
    tags.push(TAGS.functions, TAGS.documentation);

    const count = (n: number, noun: string) => `${n} ${noun}${n !== 1 ? 's' : ''}`;
    const exposed = [
      ...(exposedWorkflows.length > 0 ? [count(exposedWorkflows.length, 'workflow')] : []),
      ...(exposedNodeTypes.length > 0 ? [count(exposedNodeTypes.length, 'node type')] : []),
    ];
    return openApiDocument({
      ...options,
      description:
        exposed.length > 0
          ? `Bundle service with ${exposed.join(' and ')} exposed`
          : 'Bundle service with no workflows or node types exposed',
      paths,
      tags,
    });
  }

  /**
   * Generate a README.md from deploy instructions
   */
  protected generateReadme(
    instructions: DeployInstructions,
    workflowName: string,
    target: string
  ): string {
    const lines: string[] = [];

    lines.push(`# Deploy ${workflowName} to ${target}`);
    lines.push('');

    if (instructions.prerequisites.length > 0) {
      lines.push('## Prerequisites');
      lines.push('');
      instructions.prerequisites.forEach((p) => lines.push(`- ${p}`));
      lines.push('');
    }

    if (instructions.steps.length > 0) {
      lines.push('## Deployment Steps');
      lines.push('');
      instructions.steps.forEach((step, i) => {
        if (step.startsWith('  ')) {
          // Indented sub-steps rendered as code
          lines.push(`   \`${step.trim()}\``);
        } else {
          lines.push(`${i + 1}. \`${step}\``);
        }
      });
      lines.push('');
    }

    if (instructions.localTestSteps && instructions.localTestSteps.length > 0) {
      lines.push('## Local Testing');
      lines.push('');
      lines.push('Test your deployment locally before pushing to production:');
      lines.push('');
      lines.push('```bash');
      instructions.localTestSteps.forEach((step) => lines.push(step));
      lines.push('```');
      lines.push('');
    }

    if (instructions.links && instructions.links.length > 0) {
      lines.push('## Useful Links');
      lines.push('');
      instructions.links.forEach((link) => lines.push(`- [${link.label}](${link.url})`));
      lines.push('');
    }

    lines.push('---');
    lines.push(getGeneratedBranding().markdown);
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generate placeholder runtime files under `runtime/`: a function registry
   * listing the bundled workflows and node types, a builtin-functions module
   * that only imports it, and a trivial parameter resolver. They are not the
   * Flow Weaver runtime; a target that needs the real one must bundle it.
   */
  protected generateRuntimeFiles(
    outputDir: string,
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[]
  ): GeneratedFile[] {
    const files: GeneratedFile[] = [];

    // Generate function registry with workflow/nodeType metadata
    files.push(
      this.createFile(
        outputDir,
        'runtime/function-registry.ts',
        this.generateFunctionRegistryContent(workflows, nodeTypes),
        'other'
      )
    );

    // Generate builtin functions module
    files.push(
      this.createFile(
        outputDir,
        'runtime/builtin-functions.ts',
        `// Builtin functions, auto-registers known functions\nimport './function-registry.js';\n`,
        'other'
      )
    );

    // Generate parameter resolver
    files.push(
      this.createFile(
        outputDir,
        'runtime/parameter-resolver.ts',
        `// Parameter resolver\nexport function resolveFunction(param: unknown) { return typeof param === 'function' ? param : undefined; }\n`,
        'other'
      )
    );

    return files;
  }

  /**
   * Generate function registry content with workflow/nodeType metadata.
   * Used as fallback when real runtime source files aren't available.
   */
  protected generateFunctionRegistryContent(
    workflows: BundleWorkflow[],
    nodeTypes: BundleNodeType[]
  ): string {
    return `// Generated function registry
type FunctionInfo = {
  name: string;
  type: 'workflow' | 'nodeType';
  exposed: boolean;
};

const functions: FunctionInfo[] = [
${workflows.map((w) => `  { name: '${w.name}', type: 'workflow', exposed: ${w.expose} },`).join('\n')}
${nodeTypes.map((nt) => `  { name: '${nt.name}', type: 'nodeType', exposed: ${nt.expose} },`).join('\n')}
];

// Query helpers over the function list above.
export const functionRegistry = {
  list(category?: 'workflow' | 'nodeType'): FunctionInfo[] {
    return category ? functions.filter((f) => f.type === category) : functions;
  },
  get(name: string): FunctionInfo | undefined {
    return functions.find((f) => f.name === name);
  },
};
`;
  }
}

/**
 * Registry of available export targets
 */
export class ExportTargetRegistry {
  private factories = new Map<string, () => ExportTarget>();
  private instances = new Map<string, ExportTarget>();

  /**
   * Register a target factory. The target is only instantiated on first use.
   * Also accepts a pre-instantiated target.
   */
  register(nameOrTarget: string | ExportTarget, factory?: () => ExportTarget): void {
    if (typeof nameOrTarget === 'string') {
      // New lazy factory API: register(name, factory)
      this.factories.set(nameOrTarget, factory!);
    } else {
      // Legacy API: register(target) — wrap in factory
      const target = nameOrTarget;
      this.instances.set(target.name, target);
      this.factories.set(target.name, () => target);
    }
  }

  get(name: string): ExportTarget | undefined {
    if (!this.instances.has(name)) {
      const factory = this.factories.get(name);
      if (factory) this.instances.set(name, factory());
    }
    return this.instances.get(name);
  }

  getAll(): ExportTarget[] {
    for (const [name, factory] of this.factories) {
      if (!this.instances.has(name)) this.instances.set(name, factory());
    }
    return Array.from(this.instances.values());
  }

  getNames(): string[] {
    return Array.from(this.factories.keys());
  }

  /** Get deploy schemas from all registered targets (for validation/autocomplete) */
  getDeploySchemas(): Record<string, DeploySchema> {
    const schemas: Record<string, DeploySchema> = {};
    for (const target of this.getAll()) {
      if (target.deploySchema) schemas[target.name] = target.deploySchema;
    }
    return schemas;
  }
}
