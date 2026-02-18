import { generator } from '../src/generator';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const workflowContent = `
/**
 * ForEach node type with scoped ports
 * @flowWeaver nodeType
 * @label For Each
 * @input items - Array to iterate over
 * @output start scope:processItem - MANDATORY: Execute control for scope
 * @output item scope:processItem - Current item passed to scope function
 * @input success scope:processItem - MANDATORY: Success control from scope
 * @input failure scope:processItem - MANDATORY: Failure control from scope
 * @input processed scope:processItem - Processed value returned from scope
 * @output results - Processed results
 */
function forEach(
  execute: boolean,
  items: any[],
  processItem: (start: boolean, item: any) => {
    success: boolean;
    failure: boolean;
    processed: any;
  }
) {
  if (!execute) return { onSuccess: false, onFailure: false, results: [] };
  const results = items.map((item) => {
    const result = processItem(true, item);
    return result.processed;
  });
  return { onSuccess: true, onFailure: false, results };
}

/**
 * Processor node - doubles the input
 * @flowWeaver nodeType
 * @label Double
 * @input item - Value to double
 * @output processed - Doubled value
 */
function doubleValue(execute: boolean, item: any) {
  if (!execute) return { onSuccess: false, onFailure: false, processed: 0 };
  return { onSuccess: true, onFailure: false, processed: item * 2 };
}

/**
 * Workflow with forEach and scoped child
 * @flowWeaver workflow
 * @name processArray
 * @node forEach1 forEach
 * @node doubler doubleValue forEach1.processItem
 * @connect Start.items -> forEach1.items
 * @connect forEach1.item:processItem -> doubler.item
 * @connect doubler.processed -> forEach1.processed:processItem
 * @connect forEach1.results -> Exit.results
 */
export function processArray(
  execute: boolean,
  params: { items: number[] }
): { onSuccess: boolean; onFailure: boolean; results: number[] } {
  throw new Error('Not implemented - will be generated');
}

export { forEach, doubleValue };
`.trim();

const testFile = path.join(os.tmpdir(), 'test-scoped-forEach.ts');
fs.writeFileSync(testFile, workflowContent);

async function main() {
  try {
    const generatedCode = await generator.generate(testFile, 'processArray');
    console.log('=== GENERATED CODE ===');
    console.log(generatedCode);
    console.log('');
    console.log('=== CONTAINS createScope:', generatedCode.includes('createScope'));
    console.log('=== CONTAINS mergeScope:', generatedCode.includes('mergeScope'));
    console.log('=== CONTAINS scopeFn:', generatedCode.includes('scopeFn'));
  } catch (error: any) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

main();
