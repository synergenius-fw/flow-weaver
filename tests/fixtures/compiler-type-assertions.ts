
/**
 * Fixture: tests compiler type assertion generation.
 *
 * Bug 1: Custom types like MyConfig emit bare `as MyConfig` instead of
 * a safe assertion. When compiled in external-runtime mode, bare type
 * names from other modules cause TS2304 errors.
 *
 * Bug 2: Non-expression nodes return { onSuccess, onFailure, ...outputs }
 * but the compiler reads onSuccess/onFailure from the result without
 * casting, causing TS2339 when the function's TS return type doesn't
 * explicitly list them (even though they exist at runtime).
 */

interface MyConfig {
  name: string;
  value: number;
}

/**
 * @flowWeaver nodeType
 * @expression
 * @label Load Config
 * @input raw [order:0] - Raw config string
 * @output config [order:0] - Parsed config
 */
function loadConfig(raw: string): MyConfig {
  return JSON.parse(raw);
}

/**
 * @flowWeaver nodeType
 * @label Process
 * @input config [order:0] - Config object
 * @input execute [order:-1] - Execute
 * @output result [order:0] - Processing result
 * @output onSuccess [order:-2] - On Success
 * @output onFailure [order:-1] - On Failure
 */
function processData(
  execute: boolean,
  config: MyConfig,
): { onSuccess: boolean; onFailure: boolean; result: string } {
  if (!execute) return { onSuccess: false, onFailure: false, result: '' };
  return { onSuccess: true, onFailure: false, result: `Processed ${config.name}` };
}

/**
 * @flowWeaver workflow
 * @node loader loadConfig
 * @node proc processData
 * @path Start -> loader -> proc -> Exit
 * @connect proc.result -> Exit.result
 * @param execute [order:-1] - Execute
 * @param raw [order:0] - Raw config string
 * @returns onSuccess [order:-2] - On Success
 * @returns onFailure [order:-1] - On Failure
 * @returns result [order:0] - Output
 */
export async function typeAssertionWorkflow(
  execute: boolean,
  params: { raw: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; result: string }> {
  throw new Error('Not implemented');
  return { onSuccess: false, onFailure: true, result: '' };
}
