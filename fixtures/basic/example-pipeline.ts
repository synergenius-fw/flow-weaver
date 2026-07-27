
/**
 * @path example — linear chain sugar for sequential workflows.
 *
 * @path auto-wires a specified chain of nodes:
 *   Start → validator → transformer → outputter → Exit
 * Control flow (onSuccess→execute) and matching data ports are connected automatically.
 *
 * Run: fw run fixtures/basic/example-pipeline.ts --params '{"data":"hello world"}'
 */

/**
 * @flowWeaver nodeType
 * @input data [order:1]
 * @input execute [order:0] - Execute
 * @output result [order:2]
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function validateInput(execute: boolean, data: string): {
  onSuccess: boolean;
  onFailure: boolean;
  result: string;
} {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  if (!data || data.trim().length === 0) {
    return { onSuccess: false, onFailure: true, result: '' };
  }
  return { onSuccess: true, onFailure: false, result: data.trim() };
}

/**
 * @flowWeaver nodeType
 * @input result [order:1]
 * @input execute [order:0] - Execute
 * @output result [order:2]
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function transformData(execute: boolean, result: string): {
  onSuccess: boolean;
  onFailure: boolean;
  result: string;
} {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  return { onSuccess: true, onFailure: false, result: result.toUpperCase() };
}

/**
 * @flowWeaver nodeType
 * @input result [order:1]
 * @input execute [order:0] - Execute
 * @output result [order:2]
 * @output onSuccess [order:0] - On Success
 * @output onFailure [order:1] - On Failure
 */
function formatOutput(execute: boolean, result: string): {
  onSuccess: boolean;
  onFailure: boolean;
  result: string;
} {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  return { onSuccess: true, onFailure: false, result: `[OUTPUT] ${result}` };
}

/**
 * @flowWeaver workflow
 * @node validator validateInput [position: 270 0]
 * @node transformer transformData [position: 540 0]
 * @node outputter formatOutput [position: 810 0]
 * @path Start -> validator -> transformer -> outputter -> Exit
 * @position Start 0 0
 * @position Exit 1080 0
 * @param execute [order:0] - Execute
 * @param data [order:1] - Data
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns result [order:2] - Result
 */
export function dataPipeline(
  execute: boolean,
  params: { data: string }
): { onSuccess: boolean; onFailure: boolean; result: string } {
  throw new Error('Not implemented');
}
