/**
 * Flow Weaver Testing Utilities
 *
 * Deterministic testing for agent workflows.
 *
 * ```typescript
 * import {
 *   createMockLlmProvider,
 *   createRecordingProvider,
 *   createReplayProvider,
 *   loadRecording,
 *   expectAgentResult,
 *   expectMockLlm,
 *   TokenTracker,
 * } from 'flow-weaver/testing';
 * ```
 */

export { createMockLlmProvider } from './mock-llm';
export type {
  MockLlmProvider,
  MockLlmResponse,
  MockLlmCall,
  LLMProvider,
  LLMMessage,
  LLMResponse,
  LLMToolCall,
  LLMTool,
  LLMTokenUsage,
} from './mock-llm';

export { expectAgentResult, expectMockLlm } from './assertions';
export type { AgentResultAssertions, MockLlmAssertions } from './assertions';

export { TokenTracker } from './token-tracker';
export type { TrackedStep } from './token-tracker';

export { createRecordingProvider } from './recorder';
export type { RecordingLlmProvider, LlmRecording, LlmRecordingStep } from './recorder';

export { createReplayProvider, loadRecording } from './replayer';
export type { ReplayOptions } from './replayer';

export { createMockApprovalProvider } from './mock-approval';
export type {
  MockApprovalProvider,
  MockApprovalResponse,
  MockApprovalCall,
  ApprovalProvider,
  ApprovalRequest,
  ApprovalResult,
} from './mock-approval';
