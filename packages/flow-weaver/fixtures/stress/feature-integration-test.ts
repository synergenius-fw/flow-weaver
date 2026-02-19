/**
 * Feature Integration Test - Complete Feature Coverage
 *
 * This workflow demonstrates ALL 17 features working together:
 * 1. External dependencies (import validateUser)
 * 2. Node metadata (labels, descriptions, colors)
 * 3. All data types (NUMBER, STRING, BOOLEAN, ARRAY, OBJECT)
 * 4. Default values (formatScore precision)
 * 5. Expression-based values (calculateScore multiplier from Start)
 * 6. Optional inputs (formatScore precision)
 * 7. Pull execution (expensiveAnalysis lazy evaluation)
 * 8. Value-based branching (validateUser isValid)
 * 9. Exception-based branching (processSettings try/catch)
 * 10. Success/failure ports (validateUser, processSettings)
 * 11. Sequential execution (validateUser → processUserData)
 * 12. Parallel execution (fork to score and settings paths)
 * 13. Scoped execution (automatic in branches)
 * 14. ExecutionContext (variable tracking)
 * 15. Debugging events (STATUS_CHANGED, VARIABLE_SET, LOG_ERROR)
 * 16. executeWhen: CONJUNCTION (mergeResults waits for both)
 * 17. Complex workflow structure (10 nodes, ~25 connections)
 *
 * Scenario: User profile scoring system with settings validation
 */

// Import external node (FEATURE 1: External dependencies)
import { validateUser } from './feature-integration-utils';

// ============================================================================
// SUCCESS PATH NODES (after validation)
// ============================================================================

/**
 * FEATURE TEST: Sequential execution
 * Processes validated user data for downstream nodes
 *
 * @flowWeaver nodeType
 * @input userId
 * @input age
 * @input tags
 * @output userId
 * @output age
 * @output tags
 */
function processUserData(execute: boolean, userId: string, age: number, tags: any[]) {
  if (!execute) return { onSuccess: false, onFailure: false, userId: '', age: 0, tags: [] };
  return { onSuccess: true, onFailure: false, userId, age, tags };
}

// ============================================================================
// FAILURE PATH NODES
// ============================================================================

/**
 * FEATURE TEST: Value-based branching (failure path)
 * Handles invalid user data
 *
 * @flowWeaver nodeType
 * @output error
 */
function handleInvalidUser(execute: boolean) {
  if (!execute) return { onSuccess: false, onFailure: false, error: '' };
  return {
    onSuccess: true,
    onFailure: false,
    error: 'Invalid user: userId is empty or age is invalid'
  };
}

// ============================================================================
// PARALLEL PATH A: SCORE CALCULATION
// ============================================================================

/**
 * FEATURE TEST: Node metadata, Expression-based values
 * Calculates user score using expression to get multiplier from Start node
 *
 * @flowWeaver nodeType
 * @label Score Calculator
 * @description Calculates base score from age and multiplier
 * @color #2196F3
 * @input age
 * @input multiplier - Expression: (ctx) => ctx.getVariable({ id: 'Start', portName: 'defaultMultiplier', executionIndex: 0 })
 * @output baseScore
 */
function calculateScore(execute: boolean, age: number, multiplier: number) {
  if (!execute) return { onSuccess: false, onFailure: false, baseScore: 0 };
  return { onSuccess: true, onFailure: false, baseScore: age * multiplier };
}

/**
 * FEATURE TEST: Pull execution
 * Expensive analysis only runs if Exit needs the result (lazy evaluation)
 *
 * @flowWeaver nodeType
 * @label Expensive Analysis
 * @pullExecution execute
 * @input baseScore
 * @input tags
 * @output analysis
 */
function expensiveAnalysis(execute: boolean, baseScore: number, tags: any[]) {
  if (!execute) return { onSuccess: false, onFailure: false, analysis: {} };
  console.log('[PULL EXECUTION] expensiveAnalysis executing lazily');
  const level = baseScore < 30 ? 'beginner' : baseScore < 60 ? 'intermediate' : 'expert';
  return {
    onSuccess: true,
    onFailure: false,
    analysis: {
      level,
      tags,
      computed: true
    }
  };
}

/**
 * FEATURE TEST: Optional inputs, Default values
 * Formats score with optional precision (defaults to 2 if not connected)
 *
 * @flowWeaver nodeType
 * @input baseScore
 * @input [precision=2]
 * @output formattedScore
 */
function formatScore(execute: boolean, baseScore: number, precision?: number) {
  if (!execute) return { onSuccess: false, onFailure: false, formattedScore: 0 };
  const p = precision !== undefined ? precision : 2;
  return { onSuccess: true, onFailure: false, formattedScore: Number(baseScore.toFixed(p)) };
}

// ============================================================================
// PARALLEL PATH B: SETTINGS PROCESSING
// ============================================================================

/**
 * FEATURE TEST: Exception-based branching
 * Processes settings - throws exception if settings is null/invalid
 *
 * @flowWeaver nodeType
 * @label Settings Processor
 * @input settings
 * @output settings
 */
function processSettings(execute: boolean, settings: any) {
  if (!execute) return { onSuccess: false, onFailure: false, settings: {} };
  if (!settings || typeof settings !== 'object') {
    throw new Error('Invalid settings object');
  }
  return { onSuccess: true, onFailure: false, settings };
}

/**
 * FEATURE TEST: Exception-based branching (success path)
 * Transforms valid settings
 *
 * @flowWeaver nodeType
 * @input settings
 * @output transformedSettings
 */
function transformSettings(execute: boolean, settings: any) {
  if (!execute) return { onSuccess: false, onFailure: false, transformedSettings: {} };
  return {
    onSuccess: true,
    onFailure: false,
    transformedSettings: {
      ...settings,
      validated: true,
      timestamp: Date.now()
    }
  };
}

/**
 * FEATURE TEST: Exception-based branching (failure path)
 * Provides default settings when processing fails
 *
 * @flowWeaver nodeType
 * @output defaultSettings
 */
function useDefaultSettings(execute: boolean) {
  if (!execute) return { onSuccess: false, onFailure: false, defaultSettings: {} };
  return {
    onSuccess: true,
    onFailure: false,
    defaultSettings: {
      theme: 'light',
      notifications: false,
      validated: false,
      isDefault: true
    }
  };
}

// ============================================================================
// MERGE NODE
// ============================================================================

/**
 * FEATURE TEST: executeWhen: CONJUNCTION, Parallel execution merge
 * Waits for BOTH parallel paths to complete before executing
 *
 * @flowWeaver nodeType
 * @label Result Merger
 * @executeWhen CONJUNCTION
 * @input signal1 - From score path
 * @input signal2 - From transform settings path
 * @input signal2b - From default settings path
 * @input userId
 * @input formattedScore
 * @input analysis
 * @input settings - From transform settings path
 * @input defaultSettings - From default settings path
 * @output userId
 * @output score
 * @output analysis
 * @output settings
 * @output success
 */
function mergeResults(execute: boolean, signal1: any,
  signal2: any,
  signal2b: any,
  userId: string,
  formattedScore: number,
  analysis: any,
  settings: any,
  defaultSettings: any) {
  if (!execute) return { onSuccess: false, onFailure: false, userId: '', score: 0, analysis: {}, settings: {}, success: false };
  return {
    onSuccess: true,
    onFailure: false,
    userId,
    score: formattedScore,
    analysis,
    settings: settings || defaultSettings,
    success: true
  };
}

// ============================================================================
// WORKFLOW DEFINITION
// ============================================================================

/**
 * Complete Feature Integration Workflow
 *
 * Tests all 17 features in one workflow:
 * - START: All 6 data types (STRING, NUMBER, ARRAY, OBJECT, BOOLEAN, NUMBER)
 * - VALIDATION: External import, value-based branching
 * - PARALLEL PATHS: Score calculation + Settings processing
 * - MERGE: executeWhen: CONJUNCTION
 * - EXIT: Multiple outputs
 *
 * @flowWeaver workflow
 * @node validateUser validateUser
 * @node processUserData processUserData
 * @node handleInvalidUser handleInvalidUser
 * @node calculateScore calculateScore
 * @node expensiveAnalysis expensiveAnalysis
 * @node formatScore formatScore
 * @node processSettings processSettings
 * @node transformSettings transformSettings
 * @node useDefaultSettings useDefaultSettings
 * @node mergeResults mergeResults
 * @path Start -> validateUser -> processUserData -> calculateScore -> formatScore -> mergeResults -> Exit
 * @path Start -> validateUser -> processUserData -> calculateScore -> expensiveAnalysis -> mergeResults -> Exit
 * @path Start -> validateUser:fail -> handleInvalidUser -> Exit
 * @path Start -> processSettings -> transformSettings -> mergeResults -> Exit
 * @path Start -> processSettings:fail -> useDefaultSettings -> mergeResults -> Exit
 * @connect Start.userId -> validateUser.userId
 * @connect Start.age -> validateUser.age
 * @connect validateUser.onSuccess -> processUserData.execute
 * @connect validateUser.userId -> processUserData.userId
 * @connect validateUser.age -> processUserData.age
 * @connect Start.tags -> processUserData.tags
 * @connect validateUser.onFailure -> handleInvalidUser.execute
 * @connect handleInvalidUser.error -> Exit.error
 * @connect processUserData.age -> calculateScore.age
 * @connect calculateScore.baseScore -> expensiveAnalysis.baseScore
 * @connect processUserData.tags -> expensiveAnalysis.tags
 * @connect calculateScore.baseScore -> formatScore.baseScore
 * @connect Start.settings -> processSettings.settings
 * @connect processSettings.onSuccess -> transformSettings.execute
 * @connect processSettings.settings -> transformSettings.settings
 * @connect processSettings.onFailure -> useDefaultSettings.execute
 * @connect formatScore.formattedScore -> mergeResults.signal1
 * @connect transformSettings.transformedSettings -> mergeResults.signal2
 * @connect useDefaultSettings.defaultSettings -> mergeResults.signal2b
 * @connect processUserData.userId -> mergeResults.userId
 * @connect formatScore.formattedScore -> mergeResults.formattedScore
 * @connect expensiveAnalysis.analysis -> mergeResults.analysis
 * @connect transformSettings.transformedSettings -> mergeResults.settings
 * @connect useDefaultSettings.defaultSettings -> mergeResults.defaultSettings
 * @connect mergeResults.userId -> Exit.userId
 * @connect mergeResults.score -> Exit.score
 * @connect mergeResults.analysis -> Exit.analysis
 * @connect mergeResults.settings -> Exit.settings
 * @connect mergeResults.success -> Exit.success
 */
export async function processUserProfile(execute: boolean, params: {
  userId: string;
  age: number;
  tags: string[];
  settings: any;
  debug: boolean;
  defaultMultiplier: number;
}): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  userId?: string;
  score?: number;
  analysis?: any;
  settings?: any;
  success?: boolean;
  error?: string;
}> {
  throw new Error('Not implemented - will be generated');
}
