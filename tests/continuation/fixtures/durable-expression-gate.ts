// A gated workflow whose gate inputs are expressions referencing upstream
// ports, so no node exists only to shape values for the gate.

/**
 * @flowWeaver nodeType
 * @expression
 * @durablePure
 * @input path - File under review
 * @output risk - A label derived from the name
 */
function assess(path: string): { risk: string } {
  return { risk: path.endsWith('.ts') ? 'high' : 'low' };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @durablePure
 * @input agentResult - What the agent replied
 * @input risk - The label
 * @output report - Combined
 */
function finish(agentResult: Record<string, unknown>, risk: string): { report: string } {
  return { report: `${risk}: ${String(agentResult?.summary ?? '(none)')}` };
}

/**
 * @flowWeaver workflow
 * @param path - File under review
 * @returns report - The report
 * @node assess assess
 * @node reviewer waitForAgent [expr: agentId="'review'", context="{ path: Start.path, risk: assess.risk }", prompt="`Review ${Start.path} (risk ${assess.risk})`"]
 * @node done finish
 * @path Start -> assess -> reviewer -> done -> Exit
 * @path Start -> assess -> reviewer:fail -> Exit
 * @connect assess.risk -> done.risk
 */
export async function expressionGate(
  execute: boolean,
  params: { path: string }
): Promise<{ onSuccess: boolean; onFailure: boolean; report: string }> {
  throw new Error('generated body was not installed');
}
