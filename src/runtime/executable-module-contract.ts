import { GENERATOR_ABI, type ContinuationGraphCompatibility } from './continuation.js';

export const EXECUTABLE_WORKFLOW_MODULE_FORMAT = 1 as const;
export const EXECUTABLE_WORKFLOW_METADATA_EXPORT = '__flowWeaverExecutableArtifact' as const;

export interface ExecutableWorkflowModuleMetadata {
  readonly formatVersion: typeof EXECUTABLE_WORKFLOW_MODULE_FORMAT;
  readonly generatorAbi: typeof GENERATOR_ABI;
  readonly workflowName: string;
  readonly workflowNames: readonly string[];
  readonly graphFingerprint: string;
  readonly continuationGraph: ContinuationGraphCompatibility;
  readonly capabilities: {
    readonly gate: boolean;
    readonly effect: boolean;
  };
}
