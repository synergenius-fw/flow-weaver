// --- Native node providers (self-contained, no shared imports) ---

interface LLMProvider {
  chat(messages: Array<{ role: string; content: string }>, options?: { temperature?: number }): Promise<string>;
}

const llm: LLMProvider = (globalThis as any).__fw_llm_provider__ ?? {
  async chat(messages: Array<{ role: string; content: string }>) {
    const content = messages[messages.length - 1]?.content ?? '';
    const findings: Array<{ file: string; line: number; category: string; description: string }> = [];
    if (/eval\s*\(/.test(content)) {
      findings.push({ file: 'unknown', line: 0, category: 'security', description: 'Use of eval() detected.' });
    }
    if (/password\s*[:=]\s*['"][^'"]+['"]/i.test(content)) {
      findings.push({ file: 'unknown', line: 0, category: 'security', description: 'Hardcoded password detected.' });
    }
    if (/TODO|FIXME|HACK/i.test(content)) {
      findings.push({ file: 'unknown', line: 0, category: 'style', description: 'Unresolved TODO/FIXME/HACK.' });
    }
    return JSON.stringify(findings);
  },
};

// --- Workflow types ---

type Finding = { file: string; line: number; category: string; description: string };

interface PRInput {
  diff: string;
  title: string;
  author: string;
  number: number;
  repo: string;
}

interface ReviewContext {
  pr: PRInput;
  findings: Finding[];
  classified: { critical: Finding[]; warnings: Finding[]; suggestions: Finding[] };
}

interface ReviewResult {
  comment: string;
  action: 'approve' | 'request_changes';
}

/**
 * @flowWeaver workflow
 * @param pr - PR data
 * @returns review - Result
 * @node analyze     analyzeDiff     [color: "purple"]  [icon: "psychology"]  [position: 320 0]
 * @node classify    classifySeverity [color: "cyan"]   [icon: "filterAlt"]   [position: 640 0]
 * @node route       routeReview     [color: "orange"]  [icon: "callSplit"]   [position: 960 0]
 * @node approve     approveClean    [color: "green"]   [icon: "checkCircle"] [position: 1280 -80]
 * @node request     requestChanges  [color: "red"]     [icon: "warning"]     [position: 1280 80]
 * @position Start 0 0
 * @position Exit 1600 0
 * @path Start -> analyze -> classify -> route:ok -> approve -> Exit
 * @path route:fail -> request -> Exit
 * @connect Start.pr            -> analyze.pr
 * @connect analyze.context     -> classify.context
 * @connect classify.context    -> route.context
 * @connect route.context       -> approve.context
 * @connect route.context       -> request.context
 * @connect approve.review      -> Exit.review
 * @connect request.review      -> Exit.review
 */
export async function codeReviewAgent(
  execute: boolean,
  params: { pr: PRInput },
): Promise<{
  onSuccess: boolean;
  onFailure: boolean;
  review: ReviewResult | null;
}> {
  return { onSuccess: true, onFailure: false, review: null };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @async
 * @color purple
 * @icon psychology
 * @label Analyze Diff
 * @input pr [type: OBJECT] - PR data
 * @output context [type: OBJECT] - Context
 * @output onFailure [hidden] - Suppressed
 */
async function analyzeDiff(pr: PRInput): Promise<{ context: ReviewContext }> {
  const response = await llm.chat([
    {
      role: 'system',
      content: 'Analyze the diff for security, quality, and style issues.\nReturn a JSON array of { file, line, category, description }.',
    },
    {
      role: 'user',
      content: `PR: ${pr.repo}#${pr.number} — ${pr.title} by ${pr.author}\n\nDiff:\n${pr.diff}`,
    },
  ], { temperature: 0.2 });

  let findings: Finding[];
  try {
    const cleaned = response.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    findings = JSON.parse(cleaned);
  } catch {
    findings = [];
  }

  return {
    context: {
      pr,
      findings,
      classified: { critical: [], warnings: [], suggestions: [] },
    },
  };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @color cyan
 * @icon filterAlt
 * @label Classify Severity
 * @input context [type: OBJECT] - Context
 * @output context [type: OBJECT] - Context
 * @output onFailure [hidden] - Suppressed
 */
function classifySeverity(context: ReviewContext): { context: ReviewContext } {
  const critical = context.findings.filter(f => f.category === 'security');
  const warnings = context.findings.filter(f => f.category === 'quality');
  const suggestions = context.findings.filter(f => f.category === 'style');

  return {
    context: { ...context, classified: { critical, warnings, suggestions } },
  };
}

/**
 * @flowWeaver nodeType
 * @color orange
 * @icon callSplit
 * @label Route Review
 * @input execute [order:-1] - Execute
 * @input context [order:0] [type: OBJECT] - Context
 * @output onSuccess [order:-2] - OK
 * @output onFailure [order:-1] - Fail
 * @output context [order:0] [type: OBJECT] - Context
 */
function routeReview(
  execute: boolean,
  context: ReviewContext,
): { onSuccess: boolean; onFailure: boolean; context: ReviewContext } {
  if (!execute) return { onSuccess: false, onFailure: false, context };
  const hasCritical = context.classified.critical.length > 0;
  return { onSuccess: !hasCritical, onFailure: hasCritical, context };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @color green
 * @icon checkCircle
 * @label Approve
 * @input context [type: OBJECT] - Context
 * @output review [type: OBJECT] - Result
 * @output onFailure [hidden] - Suppressed
 */
function approveClean(context: ReviewContext): { review: ReviewResult } {
  const lines: string[] = [
    `PR ${context.pr.repo}#${context.pr.number} — approved`,
  ];
  if (context.classified.warnings.length > 0 || context.classified.suggestions.length > 0) {
    lines.push('With comments:');
    for (const w of context.classified.warnings) lines.push(`- ${w.file}:${w.line} — ${w.description}`);
    for (const s of context.classified.suggestions) lines.push(`- ${s.file}:${s.line} — ${s.description}`);
  }
  return { review: { comment: lines.join('\n'), action: 'approve' } };
}

/**
 * @flowWeaver nodeType
 * @expression
 * @color red
 * @icon warning
 * @label Request Changes
 * @input context [type: OBJECT] - Context
 * @output review [type: OBJECT] - Result
 * @output onFailure [hidden] - Suppressed
 */
function requestChanges(context: ReviewContext): { review: ReviewResult } {
  const lines: string[] = [
    `PR ${context.pr.repo}#${context.pr.number} — changes requested`,
    `${context.classified.critical.length} critical issue(s):`,
  ];
  for (const c of context.classified.critical) lines.push(`- ${c.file}:${c.line} — ${c.description}`);
  return { review: { comment: lines.join('\n'), action: 'request_changes' } };
}
