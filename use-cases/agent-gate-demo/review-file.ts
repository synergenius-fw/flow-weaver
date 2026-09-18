/**
 * Smallest workflow that hands control to an AI agent and uses what it says.
 *
 * Three nodes: read a file, ask an agent about it, write the answer down.
 * The middle one is the point -- `waitForAgent` is a durable gate, so the
 * run does not block waiting for a reply. It yields a continuation and the
 * process is free to exit. Whoever is driving resolves the gate later and
 * execution picks up at exactly that node.
 *
 * Drive it from an assistant over MCP:
 *   fw_run    { filePath: "use-cases/agent-gate-demo/review-file.ts", params: { path: "notes.md", text: "..." } }
 *   fw_resume { runId, answer: { summary: "...", risk: "low" } }
 *
 * `fw run` on the CLI refuses a gated workflow; see the durable-gates topic.
 */

/**
 * Turns the caller's path into the task the agent will be given, under the
 * gate's own port names so `@path` wires them without a single `@connect`.
 *
 * `@durablePure` deliberately, even though a real reviewer would read the
 * file here. A `@durableEffect` node carries a heavier contract -- an
 * injected trailing `operationKey`, and a `{ receipt, result }` return
 * envelope -- because the engine has to be able to replay it after a resume
 * rather than run it twice. That contract is worth meeting for a real
 * effect; it would only obscure what this demo is about, so the text is
 * passed in instead of read from disk.
 *
 * @flowWeaver nodeType
 * @expression
 * @durablePure
 * @input path - Name of the thing under review
 * @input text - The material itself
 * @output agentId - Names the task the agent is being asked to do
 * @output context - What the agent should look at
 * @output prompt - What to do with it
 * @output name - The name, echoed through for the report
 */
export function readTarget(path: string, text: string): { agentId: string; context: object; prompt: string; name: string } {
  return {
    agentId: 'review',
    // Cap it: the context rides along inside the gate payload, which is
    // serialized into the continuation envelope the driver has to carry.
    context: { path, excerpt: text.slice(0, 4000) },
    prompt: `Review ${path} and reply with { summary, risk: "low" | "high" }.`,
    name: path,
  };
}

/**
 * Formats the agent's answer. `@durablePure` -- no I/O, same inputs give the
 * same output, so the engine is free to re-run it after a resume.
 *
 * @flowWeaver nodeType
 * @expression
 * @durablePure
 * @input name - File that was reviewed
 * @input agentResult - Whatever the agent sent back
 * @output report - Human-readable summary
 */
export function writeReport(name: string, agentResult: object): { report: string } {
  // `agentResult` is whatever JSON the agent chose to return. Read it
  // defensively -- nothing validates its shape on the way in.
  const v = agentResult as { summary?: string; risk?: string };
  return { report: `${name}\n  risk: ${v.risk ?? 'unknown'}\n  ${v.summary ?? '(no summary returned)'}` };
}

/**
 * @flowWeaver workflow
 * @param path - Name of the thing under review
 * @param text - The material itself
 * @returns report - Human-readable summary
 * @node read readTarget
 * @node agent waitForAgent
 * @node report writeReport
 * @path Start -> read -> agent -> report -> Exit
 * @path Start -> read -> agent:fail -> Exit
 */
export async function reviewFile(
  execute: boolean,
  params: { path: string; text: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; report: string }> {
  throw new Error('generated body was not installed');
}
