/**
 * Research Agent — a durable agentic loop over a list of subtopics.
 *
 * The agent processes subtopics one at a time. Each iteration pauses at a
 * durable `waitForAgent` gate, so the run checkpoints between subtopics: the
 * process can die (or simply wait for the agent) and resume at the same
 * subtopic, not from the top. This is the capability that a durable-gated
 * scope enables — a bounded, sequential loop with a gate inside it.
 *
 * Shape:
 *   researchLoop (scope owner, bounded by maxTopics)
 *     └─ scope "topic":  investigate (waitForAgent gate)  →  record finding
 */

/**
 * The scope owner. Walks the subtopics in order, up to `maxTopics`, invoking
 * the `topic` scope once per subtopic and collecting each finding. The loop is
 * sequential (await per iteration) and bounded — the two things a durable
 * closure requires of a scope that reaches a gate.
 *
 * @flowWeaver nodeType
 * @durablePure
 * @label Research Loop
 * @input subtopics - Subtopics to research, in order
 * @input [maxTopics] - Maximum subtopics to process (attempt limit)
 * @output start scope:topic - Triggers one iteration
 * @output subtopic scope:topic - The subtopic for this iteration
 * @output context scope:topic - Context object sent to the agent
 * @input success scope:topic - Iteration finished
 * @input finding scope:topic - The agent's finding for this subtopic
 * @output report - Findings, one per processed subtopic, in order
 */
async function researchLoop(
  execute: boolean,
  subtopics: string[],
  maxTopics: number = 20,
  topic: (start: boolean, subtopic: string, context: object) => Promise<{
    success: boolean;
    finding: string;
  }>,
): Promise<{ onSuccess: boolean; onFailure: boolean; report: string[] }> {
  if (!execute) return { onSuccess: false, onFailure: false, report: [] };
  const report: string[] = [];
  const bound = Math.min(subtopics.length, maxTopics);
  for (let i = 0; i < bound; i++) {
    const outcome = await topic(true, subtopics[i]!, { subtopic: subtopics[i]! });
    report.push(`${subtopics[i]}: ${outcome.finding}`);
  }
  return { onSuccess: true, onFailure: false, report };
}

/**
 * Turn one finding string into the scope's `finding` return value. A small pure
 * step so the scope body has a node reading the gate's output, mirroring a real
 * agent loop where a parse/record step follows the model call.
 *
 * @flowWeaver nodeType
 * @durablePure
 * @label Record Finding
 * @input agentResult - Raw result from the research agent
 * @output finding - The finding text to record
 */
async function recordFinding(
  execute: boolean,
  agentResult: { summary?: string },
): Promise<{ onSuccess: boolean; onFailure: boolean; finding: string }> {
  if (!execute) return { onSuccess: false, onFailure: false, finding: '' };
  const finding = agentResult?.summary ?? '(no summary)';
  return { onSuccess: true, onFailure: false, finding };
}

/**
 * Research Agent workflow: investigate each subtopic through a durable agent
 * gate inside a bounded, sequential scope, then return the collected report.
 *
 * @flowWeaver workflow
 * @param subtopics - Subtopics to research
 * @param [maxTopics] - Maximum subtopics to process
 * @returns report - One finding per subtopic
 * @node loop researchLoop [color: "purple"] [icon: "science"]
 * @node investigate waitForAgent loop.topic [color: "blue"] [icon: "smartToy"]
 * @node record recordFinding loop.topic [color: "green"] [icon: "notes"]
 * @connect Start.execute -> loop.execute
 * @connect Start.subtopics -> loop.subtopics
 * @connect Start.maxTopics -> loop.maxTopics
 * @connect loop.start:topic -> investigate.execute
 * @connect loop.subtopic:topic -> investigate.agentId
 * @connect loop.context:topic -> investigate.context
 * @connect investigate.onSuccess -> record.execute
 * @connect investigate.agentResult -> record.agentResult
 * @connect record.finding -> loop.finding:topic
 * @connect record.onSuccess -> loop.success:topic
 * @connect loop.report -> Exit.report
 */
export async function researchAgent(
  execute: boolean,
  params: { subtopics: string[]; maxTopics?: number },
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  report: string[];
}> {
  throw new Error(`Compile with: fw compile <file> — ${execute}:${String(params)}`);
}
