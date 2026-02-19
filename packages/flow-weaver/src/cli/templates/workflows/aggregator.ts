/**
 * Aggregator Template
 * Combine multiple inputs into a single output
 */

import type { WorkflowTemplate, WorkflowTemplateOptions } from "../index";

export const aggregatorTemplate: WorkflowTemplate = {
  id: "aggregator",
  name: "Aggregator",
  description: "Combine multiple data sources into one output",
  category: "data-processing",
  generate: (opts: WorkflowTemplateOptions): string => {
    const { workflowName, async: isAsync } = opts;
    const asyncKeyword = isAsync ? "async " : "";
    const returnType = isAsync
      ? "Promise<{ onSuccess: boolean; onFailure: boolean; aggregated: any }>"
      : "{ onSuccess: boolean; onFailure: boolean; aggregated: any }";

    return `
// Use @expression for pure functions, normal mode for branching

/**
 * Fetches data from source A
 *
 * @flowWeaver nodeType
 * @expression
 * @label Fetch Source A
 * @input query [order:0] - Query parameters
 * @output data [order:0] - Data from source A
 */
function fetchSourceA(query: any): { data: any } {
  // TODO: Fetch from source A
  return { data: { source: "A", items: [] } };
}

/**
 * Fetches data from source B
 *
 * @flowWeaver nodeType
 * @expression
 * @label Fetch Source B
 * @input query [order:0] - Query parameters
 * @output data [order:0] - Data from source B
 */
function fetchSourceB(query: any): { data: any } {
  // TODO: Fetch from source B
  return { data: { source: "B", items: [] } };
}

/**
 * Combines data from multiple sources
 *
 * @flowWeaver nodeType
 * @expression
 * @label Combine Data
 * @input dataA [order:0] - Data from source A
 * @input dataB [order:1] - Data from source B
 * @output aggregated [order:0] - Combined data
 */
function combineData(dataA: any, dataB: any): { aggregated: any } {
  // TODO: Implement aggregation logic
  return {
    aggregated: {
      sources: [dataA?.source, dataB?.source],
      totalItems: (dataA?.items?.length || 0) + (dataB?.items?.length || 0),
      items: [...(dataA?.items || []), ...(dataB?.items || [])],
      aggregatedAt: new Date().toISOString()
    }
  };
}

/**
 * @flowWeaver workflow
 * @node sourceA fetchSourceA
 * @node sourceB fetchSourceB
 * @node combiner combineData
 * @position Start -450 0
 * @position sourceA -180 -90
 * @position sourceB -180 90
 * @position combiner 90 0
 * @position Exit 360 0
 * @connect Start.execute -> sourceA.execute
 * @connect Start.execute -> sourceB.execute
 * @connect Start.query -> sourceA.query
 * @connect Start.query -> sourceB.query
 * @connect sourceA.onSuccess -> combiner.execute
 * @connect sourceA.data -> combiner.dataA
 * @connect sourceB.data -> combiner.dataB
 * @connect combiner.aggregated -> Exit.aggregated
 * @connect combiner.onSuccess -> Exit.onSuccess
 * @connect combiner.onFailure -> Exit.onFailure
 * @param execute [order:0] - Execute
 * @param query [order:1] - Query parameters for fetching
 * @returns onSuccess [order:0] - On Success
 * @returns onFailure [order:1] - On Failure
 * @returns aggregated [order:2] - Combined data from all sources
 */
export ${asyncKeyword}function ${workflowName}(
  execute: boolean,
  params: { query: any }
): ${returnType} {
  throw new Error("Compile with: flow-weaver compile <file>");
}
`.trim();
  },
};
