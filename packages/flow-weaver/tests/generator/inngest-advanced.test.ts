/**
 * Tests for Inngest 1B2 advanced primitives:
 * - Typed event schemas (Zod)
 * - Cron trigger
 * - CancelOn
 * - Delay built-in node
 * - WaitForEvent built-in node
 * - InvokeWorkflow built-in node
 * - Serve handler
 * - @retries annotation
 * - @timeout annotation
 * - @throttle annotation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, afterAll } from 'vitest';
import {
  generateInngestFunction,
  type InngestGenerationOptions,
} from '../../src/generator/inngest';
import { parser } from '../../src/parser';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-inngest-adv-'));

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

function parseAndGenerate(source: string, options?: InngestGenerationOptions): string {
  const tmpFile = path.join(tmpDir, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`);
  fs.writeFileSync(tmpFile, source);
  const result = parser.parse(tmpFile);
  expect(result.errors).toHaveLength(0);
  expect(result.workflows.length).toBeGreaterThan(0);

  const workflow = result.workflows[0];
  const allNodeTypes = [...(workflow.nodeTypes || [])];
  return generateInngestFunction(workflow, allNodeTypes, options);
}

// ---------------------------------------------------------------------------
// Fixture workflows
// ---------------------------------------------------------------------------

const TYPED_EVENT_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input url
 * @output data
 */
function fetchData(execute: boolean, url: string): { onSuccess: boolean; onFailure: boolean; data: object } {
  return { onSuccess: true, onFailure: false, data: {} };
}

/**
 * @flowWeaver workflow
 * @param {string} url - Target URL
 * @param {number} retries - Number of retries
 * @node f fetchData
 * @connect Start.url -> f.url
 * @connect f.data -> Exit.result
 * @returns {object} result - Result data
 */
export function typedPipeline(execute: boolean, params: { url: string; retries: number }): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
`;

const CRON_TRIGGER_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @output data
 */
function sync(execute: boolean): { onSuccess: boolean; onFailure: boolean; data: object } {
  return { onSuccess: true, onFailure: false, data: {} };
}

/**
 * @flowWeaver workflow
 * @trigger cron="0 9 * * *"
 * @node s sync
 * @connect Start.execute -> s.execute
 * @connect s.data -> Exit.result
 * @returns {object} result
 */
export function dailySync(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
`;

const CANCEL_ON_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @output data
 */
function process(execute: boolean): { onSuccess: boolean; onFailure: boolean; data: object } {
  return { onSuccess: true, onFailure: false, data: {} };
}

/**
 * @flowWeaver workflow
 * @cancelOn event="app/user.deleted" match="data.userId"
 * @node p process
 * @connect Start.execute -> p.execute
 * @connect p.data -> Exit.result
 * @returns {object} result
 */
export function cancelable(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
`;

const DELAY_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @input url
 * @output data
 */
function fetchData(execute: boolean, url: string): { onSuccess: boolean; onFailure: boolean; data: object } {
  return { onSuccess: true, onFailure: false, data: {} };
}

/**
 * @flowWeaver nodeType
 * @input duration
 * @output elapsed
 */
async function delay(execute: boolean, duration: string): Promise<{ onSuccess: boolean; onFailure: boolean; elapsed: boolean }> {
  return { onSuccess: true, onFailure: false, elapsed: true };
}

/**
 * @flowWeaver workflow
 * @param {string} url - URL to fetch
 * @node f fetchData
 * @node d delay
 * @node f2 fetchData
 * @connect Start.url -> f.url
 * @connect f.onSuccess -> d.execute
 * @connect d.onSuccess -> f2.execute
 * @connect Start.url -> f2.url
 * @connect f2.data -> Exit.result
 * @returns {object} result
 */
export function delayedPipeline(execute: boolean, params: { url: string }): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
`;

const WAIT_FOR_EVENT_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @output data
 */
function processApproved(execute: boolean): { onSuccess: boolean; onFailure: boolean; data: object } {
  return { onSuccess: true, onFailure: false, data: {} };
}

/**
 * @flowWeaver nodeType
 * @output sent
 */
function notifyTimeout(execute: boolean): { onSuccess: boolean; onFailure: boolean; sent: boolean } {
  return { onSuccess: true, onFailure: false, sent: true };
}

/**
 * @flowWeaver nodeType
 * @input eventName
 * @input [match]
 * @input [timeout]
 * @output eventData
 */
async function waitForEvent(execute: boolean, eventName: string, match?: string, timeout?: string): Promise<{ onSuccess: boolean; onFailure: boolean; eventData: object }> {
  return { onSuccess: true, onFailure: false, eventData: {} };
}

/**
 * @flowWeaver workflow
 * @node w waitForEvent
 * @node pa processApproved
 * @node nt notifyTimeout
 * @connect Start.execute -> w.execute
 * @connect w.onSuccess -> pa.execute
 * @connect w.eventData -> pa.execute
 * @connect w.onFailure -> nt.execute
 * @connect pa.data -> Exit.result
 * @returns {object} result
 */
export function approvalFlow(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
`;

const INVOKE_WORKFLOW_FIXTURE = `
/**
 * @flowWeaver nodeType
 * @input functionId
 * @input payload
 * @input [timeout]
 * @output result
 */
async function invokeWorkflow(execute: boolean, functionId: string, payload: object, timeout?: string): Promise<{ onSuccess: boolean; onFailure: boolean; result: object }> {
  return { onSuccess: true, onFailure: false, result: {} };
}

/**
 * @flowWeaver workflow
 * @node inv invokeWorkflow
 * @connect Start.execute -> inv.execute
 * @connect inv.result -> Exit.result
 * @returns {object} result
 */
export function parentFlow(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
`;

const SERVE_HANDLER_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @output data
 */
function doWork(execute: boolean): { onSuccess: boolean; onFailure: boolean; data: object } {
  return { onSuccess: true, onFailure: false, data: {} };
}

/**
 * @flowWeaver workflow
 * @node w doWork
 * @connect Start.execute -> w.execute
 * @connect w.data -> Exit.result
 * @returns {object} result
 */
export function serveWorkflow(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
`;

const RETRIES_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @output data
 */
function doWork(execute: boolean): { onSuccess: boolean; onFailure: boolean; data: object } {
  return { onSuccess: true, onFailure: false, data: {} };
}

/**
 * @flowWeaver workflow
 * @retries 5
 * @node w doWork
 * @connect Start.execute -> w.execute
 * @connect w.data -> Exit.result
 * @returns {object} result
 */
export function retriesWorkflow(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
`;

const TIMEOUT_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @output data
 */
function doWork(execute: boolean): { onSuccess: boolean; onFailure: boolean; data: object } {
  return { onSuccess: true, onFailure: false, data: {} };
}

/**
 * @flowWeaver workflow
 * @timeout "30m"
 * @node w doWork
 * @connect Start.execute -> w.execute
 * @connect w.data -> Exit.result
 * @returns {object} result
 */
export function timeoutWorkflow(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
`;

const THROTTLE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @output data
 */
function doWork(execute: boolean): { onSuccess: boolean; onFailure: boolean; data: object } {
  return { onSuccess: true, onFailure: false, data: {} };
}

/**
 * @flowWeaver workflow
 * @throttle limit=3 period="1m"
 * @node w doWork
 * @connect Start.execute -> w.execute
 * @connect w.data -> Exit.result
 * @returns {object} result
 */
export function throttleWorkflow(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
`;

const SIMPLE_WORKFLOW = `
/**
 * @flowWeaver nodeType
 * @output data
 */
function doWork(execute: boolean): { onSuccess: boolean; onFailure: boolean; data: object } {
  return { onSuccess: true, onFailure: false, data: {} };
}

/**
 * @flowWeaver workflow
 * @node w doWork
 * @connect Start.execute -> w.execute
 * @connect w.data -> Exit.result
 * @returns {object} result
 */
export function simpleWorkflow(execute: boolean): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
`;

const TYPED_EVENT_WITH_TRIGGER = `
/**
 * @flowWeaver nodeType
 * @input url
 * @output data
 */
function fetchData(execute: boolean, url: string): { onSuccess: boolean; onFailure: boolean; data: object } {
  return { onSuccess: true, onFailure: false, data: {} };
}

/**
 * @flowWeaver workflow
 * @trigger event="app/data.submitted"
 * @param {string} url - Target URL
 * @node f fetchData
 * @connect Start.url -> f.url
 * @connect f.data -> Exit.result
 * @returns {object} result
 */
export function triggerTyped(execute: boolean, params: { url: string }): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('typed event schemas', () => {
  it('generates Zod schema from @param annotations', () => {
    const code = parseAndGenerate(TYPED_EVENT_WORKFLOW, { typedEvents: true });
    expect(code).toContain("import { z } from 'zod'");
    expect(code).toContain('z.string()'); // url param
    expect(code).toContain('z.number()'); // retries param
  });

  it('omits Zod schema when typedEvents is false', () => {
    const code = parseAndGenerate(TYPED_EVENT_WORKFLOW);
    expect(code).not.toContain('z.string()');
    expect(code).not.toContain("from 'zod'");
  });

  it('uses trigger event name for schema when @trigger is set', () => {
    const code = parseAndGenerate(TYPED_EVENT_WITH_TRIGGER, { typedEvents: true });
    // Schema should use the actual trigger event name, not the auto-generated one
    expect(code).toContain("name: 'app/data.submitted'");
    expect(code).not.toContain('fw/');
  });
});

describe('cron trigger', () => {
  it('emits cron trigger instead of event', () => {
    const code = parseAndGenerate(CRON_TRIGGER_WORKFLOW);
    expect(code).toContain("{ cron: '0 9 * * *' }");
    expect(code).not.toContain('{ event:');
  });
});

describe('cancelOn', () => {
  it('emits cancelOn in function config', () => {
    const code = parseAndGenerate(CANCEL_ON_WORKFLOW);
    expect(code).toContain('cancelOn:');
    expect(code).toContain("event: 'app/user.deleted'");
  });

  it('uses match property instead of if expression', () => {
    const code = parseAndGenerate(CANCEL_ON_WORKFLOW);
    // Inngest supports match property directly — no need for if expression
    expect(code).toContain("match: 'data.userId'");
    expect(code).not.toContain('async.data.');
  });
});

describe('delay built-in node', () => {
  it('emits step.sleep instead of step.run', () => {
    const code = parseAndGenerate(DELAY_WORKFLOW);
    expect(code).toContain("step.sleep('d'");
    expect(code).not.toContain("step.run('d'");
    expect(code).toContain("step.run('f'");
  });

  it('does not declare result variable for delay node', () => {
    const code = parseAndGenerate(DELAY_WORKFLOW);
    expect(code).not.toContain('d_result');
    expect(code).toContain('f_result');
  });

  it('does not import delay function', () => {
    const code = parseAndGenerate(DELAY_WORKFLOW);
    expect(code).not.toContain('import { delay }');
  });
});

describe('waitForEvent built-in node', () => {
  it('emits step.waitForEvent', () => {
    const code = parseAndGenerate(WAIT_FOR_EVENT_WORKFLOW);
    expect(code).toContain("step.waitForEvent('");
    expect(code).not.toContain("step.run('w'");
  });

  it('maps null result to onFailure', () => {
    const code = parseAndGenerate(WAIT_FOR_EVENT_WORKFLOW);
    expect(code).toContain('onSuccess: true, onFailure: false');
    expect(code).toContain('onSuccess: false, onFailure: true');
  });
});

describe('invokeWorkflow built-in node', () => {
  it('emits step.invoke', () => {
    const code = parseAndGenerate(INVOKE_WORKFLOW_FIXTURE);
    expect(code).toContain("step.invoke('");
    expect(code).not.toContain("step.run('inv'");
  });

  it('wraps in try/catch for onFailure mapping', () => {
    const code = parseAndGenerate(INVOKE_WORKFLOW_FIXTURE);
    expect(code).toContain('try {');
    expect(code).toContain('} catch');
    expect(code).toContain('onFailure: true');
  });
});

describe('serve handler', () => {
  it('appends serve handler when serveHandler=true', () => {
    const code = parseAndGenerate(SERVE_HANDLER_WORKFLOW, {
      serveHandler: true,
      framework: 'next',
    });
    expect(code).toContain("import { serve } from 'inngest/next'");
    expect(code).toContain('GET, POST, PUT');
    expect(code).toContain('functions:');
  });

  it('hoists serve import to top of file with other imports', () => {
    const code = parseAndGenerate(SERVE_HANDLER_WORKFLOW, {
      serveHandler: true,
      framework: 'next',
    });
    const serveImportIdx = code.indexOf("import { serve }");
    const createFnIdx = code.indexOf('createFunction(');
    // Serve import must come before the function definition
    expect(serveImportIdx).toBeGreaterThan(-1);
    expect(serveImportIdx).toBeLessThan(createFnIdx);
  });

  it('uses correct import for express framework', () => {
    const code = parseAndGenerate(SERVE_HANDLER_WORKFLOW, {
      serveHandler: true,
      framework: 'express',
    });
    expect(code).toContain("from 'inngest/express'");
  });

  it('omits serve handler by default', () => {
    const code = parseAndGenerate(SERVE_HANDLER_WORKFLOW);
    expect(code).not.toContain('serve(');
  });
});

describe('retries annotation', () => {
  it('emits retries from @retries annotation', () => {
    const code = parseAndGenerate(RETRIES_WORKFLOW);
    expect(code).toContain('retries: 5');
    expect(code).not.toContain('retries: 3');
  });
});

describe('timeout annotation', () => {
  it('emits timeouts.finish from @timeout annotation', () => {
    const code = parseAndGenerate(TIMEOUT_WORKFLOW);
    expect(code).toContain('timeouts:');
    expect(code).toContain("finish: '30m'");
  });

  it('omits timeouts when no @timeout present', () => {
    const code = parseAndGenerate(SIMPLE_WORKFLOW);
    expect(code).not.toContain('timeouts:');
  });
});

describe('throttle annotation', () => {
  it('emits throttle config from @throttle annotation', () => {
    const code = parseAndGenerate(THROTTLE_WORKFLOW);
    expect(code).toContain('throttle:');
    expect(code).toContain('limit: 3');
    expect(code).toContain("period: '1m'");
  });
});

// ---------------------------------------------------------------------------
// Built-in nodes in branching chains and nested branches
// ---------------------------------------------------------------------------

const WAIT_IN_BRANCHING_CHAIN = `
/**
 * @flowWeaver nodeType
 * @input needsApproval
 * @output autoApproved
 */
function approvalRouter(execute: boolean, needsApproval: boolean): { onSuccess: boolean; onFailure: boolean; autoApproved: boolean } {
  if (!execute) return { onSuccess: false, onFailure: false, autoApproved: false };
  if (needsApproval) return { onSuccess: false, onFailure: true, autoApproved: false };
  return { onSuccess: true, onFailure: false, autoApproved: true };
}

/**
 * @flowWeaver nodeType
 * @input eventName
 * @input [match]
 * @input [timeout]
 * @output eventData
 */
async function waitForEvent(execute: boolean, eventName: string, match?: string, timeout?: string): Promise<{ onSuccess: boolean; onFailure: boolean; eventData: object }> {
  return { onSuccess: true, onFailure: false, eventData: {} };
}

/**
 * @flowWeaver nodeType
 * @output sent
 */
function notifyTimeout(execute: boolean): { onSuccess: boolean; onFailure: boolean; sent: boolean } {
  return { onSuccess: true, onFailure: false, sent: true };
}

/**
 * @flowWeaver nodeType
 * @output record
 */
function recordApproval(execute: boolean): { onSuccess: boolean; onFailure: boolean; record: object } {
  return { onSuccess: true, onFailure: false, record: {} };
}

/**
 * waitForEvent inside a branching chain: router -> wait (chain via failure)
 *
 * @flowWeaver workflow
 * @param {boolean} needsApproval
 * @node router approvalRouter
 * @node wait waitForEvent [expr: eventName="'app/expense.approved'", timeout="'48h'"]
 * @node rec recordApproval
 * @node nt notifyTimeout
 * @connect Start.needsApproval -> router.needsApproval
 * @connect router.onFailure -> wait.execute
 * @connect wait.onSuccess -> rec.execute
 * @connect wait.onFailure -> nt.execute
 * @connect rec.record -> Exit.result
 * @returns {object} result
 */
export function chainedWait(execute: boolean, params: { needsApproval: boolean }): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
`;

const INVOKE_IN_BRANCH_BODY = `
/**
 * @flowWeaver nodeType
 * @input data
 * @output record
 */
function recordApproval(execute: boolean, data: object): { onSuccess: boolean; onFailure: boolean; record: object } {
  return { onSuccess: true, onFailure: false, record: {} };
}

/**
 * @flowWeaver nodeType
 * @input functionId
 * @input payload
 * @input [timeout]
 * @output result
 */
async function invokeWorkflow(execute: boolean, functionId: string, payload: object, timeout?: string): Promise<{ onSuccess: boolean; onFailure: boolean; result: object }> {
  return { onSuccess: true, onFailure: false, result: {} };
}

/**
 * invokeWorkflow nested inside a branch body (rec.onSuccess -> pay.execute)
 *
 * @flowWeaver workflow
 * @param {object} data
 * @node rec recordApproval
 * @node pay invokeWorkflow [expr: functionId="'payment/process'", timeout="'5m'"]
 * @connect Start.data -> rec.data
 * @connect rec.onSuccess -> pay.execute
 * @connect rec.record -> pay.payload
 * @connect pay.result -> Exit.result
 * @returns {object} result
 */
export function nestedInvoke(execute: boolean, params: { data: object }): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
`;

describe('expr attributes with Eq-token port names', () => {
  it('INVOKE_IN_BRANCH_BODY has pay instance', () => {
    const tmpFile = path.join(tmpDir, `diag-invoke-${Date.now()}.ts`);
    fs.writeFileSync(tmpFile, INVOKE_IN_BRANCH_BODY);
    const result = parser.parse(tmpFile);
    expect(result.errors).toHaveLength(0);
    const wf = result.workflows[0];
    const instanceIds = wf.instances.map((i: any) => i.id);
    expect(instanceIds).toContain('pay');
  });

  it('WAIT_IN_BRANCHING_CHAIN has wait instance', () => {
    const tmpFile = path.join(tmpDir, `diag-wait-${Date.now()}.ts`);
    fs.writeFileSync(tmpFile, WAIT_IN_BRANCHING_CHAIN);
    const result = parser.parse(tmpFile);
    expect(result.errors).toHaveLength(0);
    const wf = result.workflows[0];
    const instanceIds = wf.instances.map((i: any) => i.id);
    expect(instanceIds).toContain('wait');
  });
});

describe('waitForEvent in branching chain', () => {
  it('emits step.waitForEvent when wait is part of a branching chain', () => {
    const code = parseAndGenerate(WAIT_IN_BRANCHING_CHAIN);
    // The step.waitForEvent call must be present
    expect(code).toContain("step.waitForEvent('wait'");
    // Must not fall through to step.run
    expect(code).not.toContain("step.run('wait'");
  });

  it('declares wait_result variable', () => {
    const code = parseAndGenerate(WAIT_IN_BRANCHING_CHAIN);
    expect(code).toContain('wait_result');
  });

  it('branches on wait_result.onSuccess after step.waitForEvent', () => {
    const code = parseAndGenerate(WAIT_IN_BRANCHING_CHAIN);
    const waitForEventIdx = code.indexOf("step.waitForEvent('wait'");
    const ifIdx = code.indexOf('wait_result.onSuccess');
    expect(waitForEventIdx).toBeGreaterThan(-1);
    expect(ifIdx).toBeGreaterThan(waitForEventIdx);
  });
});

describe('invokeWorkflow in branch body', () => {
  it('emits step.invoke when invoke is inside a branch body', () => {
    const code = parseAndGenerate(INVOKE_IN_BRANCH_BODY);
    // The step.invoke call must be present
    expect(code).toContain("step.invoke('pay'");
    // Must not fall through to step.run
    expect(code).not.toContain("step.run('pay'");
  });

  it('declares pay_result variable', () => {
    const code = parseAndGenerate(INVOKE_IN_BRANCH_BODY);
    expect(code).toContain('pay_result');
  });
});

// ---------------------------------------------------------------------------
// Built-in node chain guards — built-in nodes bypass execute flag,
// so chain continuations must be explicitly guarded.
// ---------------------------------------------------------------------------

describe('chainViaFailure guard for built-in nodes', () => {
  it('guards waitForEvent behind if (!router_result.onSuccess) in chainViaFailure', () => {
    const code = parseAndGenerate(WAIT_IN_BRANCHING_CHAIN);
    // step.waitForEvent must be inside a guard that checks router failed
    // i.e. the wait should NOT run when router succeeds (auto-approve)
    const routerRunIdx = code.indexOf("step.run('router'");
    const guardIdx = code.indexOf('!router_result.onSuccess');
    const waitIdx = code.indexOf("step.waitForEvent('wait'");
    expect(routerRunIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(routerRunIdx);
    expect(waitIdx).toBeGreaterThan(guardIdx);
  });

  it('places wait branch bodies (rec, nt) inside the guard block', () => {
    const code = parseAndGenerate(WAIT_IN_BRANCHING_CHAIN);
    const guardIdx = code.indexOf('!router_result.onSuccess');
    const recIdx = code.indexOf("step.run('rec'");
    const ntIdx = code.indexOf("step.run('nt'");
    // Both rec and nt should appear after the guard
    expect(recIdx).toBeGreaterThan(guardIdx);
    expect(ntIdx).toBeGreaterThan(guardIdx);
  });
});

describe('chainViaSuccess guard for built-in nodes', () => {
  // Chain requires: one direction has 1 branching child, other has 0.
  // v success -> w (branching), v failure -> nothing => chain [v, w] via success
  const CHAIN_VIA_SUCCESS_WAIT = `
/**
 * @flowWeaver nodeType
 * @input data
 * @output validated
 */
function validate(execute: boolean, data: string): { onSuccess: boolean; onFailure: boolean; validated: object } {
  return { onSuccess: true, onFailure: false, validated: {} };
}

/**
 * @flowWeaver nodeType
 * @input eventName
 * @input [match]
 * @input [timeout]
 * @output eventData
 */
async function waitForEvent(execute: boolean, eventName: string, match?: string, timeout?: string): Promise<{ onSuccess: boolean; onFailure: boolean; eventData: object }> {
  return { onSuccess: true, onFailure: false, eventData: {} };
}

/**
 * @flowWeaver nodeType
 * @output data
 */
function processApproved(execute: boolean): { onSuccess: boolean; onFailure: boolean; data: object } {
  return { onSuccess: true, onFailure: false, data: {} };
}

/**
 * validate chains via success to waitForEvent (no failure branch on v)
 *
 * @flowWeaver workflow
 * @param {string} data
 * @node v validate
 * @node w waitForEvent [expr: eventName="'app/item.ready'", timeout="'1h'"]
 * @node pa processApproved
 * @connect Start.data -> v.data
 * @connect v.onSuccess -> w.execute
 * @connect w.onSuccess -> pa.execute
 * @connect pa.data -> Exit.result
 * @returns {object} result
 */
export function chainViaSuccessWait(execute: boolean, params: { data: string }): { onSuccess: boolean; onFailure: boolean; result: object } {
  throw new Error('Not compiled');
}
`;

  it('guards waitForEvent behind if (v_result.onSuccess) in chainViaSuccess', () => {
    const code = parseAndGenerate(CHAIN_VIA_SUCCESS_WAIT);
    const vRunIdx = code.indexOf("step.run('v'");
    // Find a POSITIVE guard (not negated) — must be `if (v_result.onSuccess)` not `if (!v_result.onSuccess)`
    const positiveGuardRegex = /if\s*\(\s*v_result\.onSuccess\s*\)/;
    const negativeGuardRegex = /if\s*\(\s*!v_result\.onSuccess\s*\)/;
    const positiveMatch = positiveGuardRegex.exec(code);
    const negativeMatch = negativeGuardRegex.exec(code);
    const waitIdx = code.indexOf("step.waitForEvent('w'");
    expect(vRunIdx).toBeGreaterThan(-1);
    expect(positiveMatch).not.toBeNull();
    expect(waitIdx).toBeGreaterThan(positiveMatch!.index);
    // The negative guard (failure branch) should exist but BEFORE the wait
    if (negativeMatch) {
      // The wait should NOT be inside the negative guard — it should be AFTER it
      expect(positiveMatch!.index).not.toBe(negativeMatch.index);
    }
  });
});
