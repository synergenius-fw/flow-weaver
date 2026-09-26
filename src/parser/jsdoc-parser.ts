/**
 * JSDoc annotation parser for Flow Weaver
 *
 * Reads a function's `@flowWeaver nodeType` or `@flowWeaver workflow` JSDoc
 * block into a config. The work is split by responsibility under `./jsdoc/`:
 *
 * - node-type-block: the `@flowWeaver nodeType` block and its tags
 * - workflow-block: the `@flowWeaver workflow` block and its tags
 * - port-tags: `@input`/`@output`/`@step` and `@param`/`@returns` ports
 * - signature-types: port types read from the function signature
 * - graph-tags: `@node`, `@connect`, `@scope` and the sugar tags
 * - runtime-tags: `@trigger`, `@http`, `@cancelOn`, `@throttle`, `@retries`,
 *   `@timeout` and `@deploy`
 * - config-types: the config shapes both blocks produce
 */
import { parseNodeType } from './jsdoc/node-type-block';
import { parseWorkflow } from './jsdoc/workflow-block';

export type { JSDocNodeTypeConfig, JSDocWorkflowConfig } from './jsdoc/config-types';

export const jsdocParser = {
  parseNodeType,
  parseWorkflow,
};
