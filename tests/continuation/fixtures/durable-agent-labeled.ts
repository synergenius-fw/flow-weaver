/**
 * Smallest workflow that hands control to an AI agent and uses what it says.
 *
 * Three nodes: read a file, ask an agent about it, write the answer down.
 * The middle one is the point -- `waitForAgent` is a durable gate, so the
 * run does not block waiting for a reply. It yields a continuation and the
 * process is free to exit. Whoever is driving (Claude Code over MCP, the
 * `fw run` CLI, a CI job) resolves the gate later with
 * `fw_workflow_resume`, and execution picks up at exactly that node.
 *
 * Run it:
 *   fw run use-cases/agent-gate-demo/review-file.ts \
 *     --params '{"path":"notes.md","text":"..."}'
 *
 * Or drive it from Claude Code once flow-weaver is registered as an MCP
 * server: `fw_workflow_run` with this filePath, answer the gate, then
 * `fw_workflow_resume`.
 */

/**
 * Turns the caller's path into the material the agent will look at.
 *
 * `@durablePure` deliberately, even though a real reviewer would read the
 * file here. A `@durableEffect` node carries a much heavier contract -- an
 * injected trailing `operationKey`, and a `{ receipt, result }` return
 * envelope instead of plain outputs -- because the engine has to be able to
 * replay it after a resume rather than run it twice. That contract is worth
 * meeting for a real effect. It would only obscure what this demo is about,
 * so the text is passed in instead of read from disk.
 *
 * @flowWeaver nodeType
 * @durablePure
 * @input path - Name of the thing under review
 * @input text - The material itself
 * @output contents - What the agent should look at
 * @output name - The name, echoed back for the report
 * @output agentId - Names the task the agent is being asked to do
 */
export async function readTarget(
  execute: boolean,
  path: string,
  text: string,
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  contents: string;
  name: string;
  agentId: string;
}> {
  if (!execute)
    return { onSuccess: false, onFailure: false, contents: '', name: '', agentId: '' };

  // Cap it: the contents ride along inside the gate payload, which is
  // serialized into the continuation envelope the driver has to carry.
  return {
    onSuccess: true,
    onFailure: false,
    contents: text.slice(0, 4000),
    name: path,
    agentId: 'review',
  };
}

/**
 * Formats the agent's answer. `@durablePure` -- no I/O, same inputs give the
 * same output, so the engine is free to re-run it after a resume.
 *
 * @flowWeaver nodeType
 * @durablePure
 * @input name - File that was reviewed
 * @input verdict - Whatever the agent sent back
 * @output report - Human-readable summary
 */
export async function writeReport(
  execute: boolean,
  name: string,
  verdict: object,
): Promise<{ onSuccess: boolean; onFailure: boolean; report: string }> {
  if (!execute) return { onSuccess: false, onFailure: false, report: '' };

  // `verdict` is whatever JSON the agent chose to return. Read it
  // defensively -- nothing validates its shape on the way in.
  const v = verdict as { summary?: string; risk?: string };
  const summary = v.summary ?? '(no summary returned)';
  const risk = v.risk ?? 'unknown';

  return {
    onSuccess: true,
    onFailure: false,
    report: `${name}\n  risk: ${risk}\n  ${summary}`,
  };
}

/**
 * @flowWeaver workflow
 * @node read readTarget
 * @node agent waitForAgent
 * @node report writeReport
 *
 * @connect Start.execute -> read.execute
 * @connect Start.path -> read.path
 * @connect Start.text -> read.text
 *
 * @connect read.onSuccess -> agent.execute
 * @connect read.agentId -> agent.agentId
 * @connect read.contents -> agent.context
 * @connect read.name -> report.name
 *
 * @connect agent.onSuccess -> report.execute
 * @connect agent.agentResult -> report.verdict
 *
 * @connect report.onSuccess -> Exit.onSuccess
 * @connect report.report -> Exit.report
 *
 * @connect read.onFailure -> Exit.onFailure
 * @connect agent.onFailure -> Exit.onFailure
 * @connect report.onFailure -> Exit.onFailure
 */
export async function reviewFile(
  execute: boolean,
  path: string,
  text: string,
): Promise<{ onSuccess: boolean; onFailure: boolean; report: string }> {
  throw new Error('Not implemented');
}
