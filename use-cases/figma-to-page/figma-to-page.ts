/**
 * Figma link -> built page, with the deterministic part doing the heavy lifting.
 *
 * The design premise: an assistant is expensive per token and unreliable at
 * bookkeeping, while a compiled workflow is free per token and exact. So every
 * step that CAN be decided from data is decided in a node, and the agent is
 * only ever woken for the two things a program cannot do -- propose a plan, and
 * write the page code. At each of those two wake-ups it is handed the smallest
 * payload that still makes the task decidable.
 *
 * Four gates, in order:
 *
 *   1. `link`    (`waitForEvent`, an `input` gate) -- ask the user for the link.
 *   2. `plan`    (`waitForAgent`, an `agent` gate) -- the agent sees a DIGEST
 *                (counts, the handful of unmatched names, the risk flags) and
 *                replies with a short plan. It never sees the mapping table.
 *   3. `approve` (a hand-written `approval` gate) -- the user accepts the plan.
 *   4. `build`   (`waitForAgent`) -- the agent gets the fully resolved build
 *                spec: real component names, import paths, resolved props per
 *                instance, in source order. Nothing is left to infer.
 *
 * Everything between the gates is deterministic and runs for free:
 * `parse` (URL validation), `extract` + `match` (the simulated Figma read and
 * library match), `digest` (the tiny agent-facing summary), `check` (rejects a
 * plan that is too long -- the token budget is enforced in code, not asked for
 * in a prompt), and `spec` (assembles the whole build spec from values already
 * in hand).
 *
 * Why the token accounting works out: the raw simulated Figma payload is 16
 * instances across 3 compositions plus 24 tokens. Sent to an agent as JSON that
 * is several thousand tokens, twice over if it has to re-read it to plan and
 * then to build. Here the planning gate sees ~15 lines and the build gate sees
 * one pre-resolved spec, assembled once, with every lookup already performed.
 *
 * Gate placement: the spine is linear -- each gate is driven from its immediate
 * predecessor's success arm -- so every gate sits in exactly one branch region,
 * which is what the continuation needs in order to replay. `finish` is wired
 * on three arms rather than by `@path` alone, so that it also runs on the two
 * rejection arms (`parse:fail` and `check:fail`), which must still produce a
 * result.
 *
 * Drive it from an assistant over MCP:
 *   fw_run    { filePath: ".../figma-to-page.ts", params: { request: { goal: "Build the pricing page" } } }
 *   fw_resume { runId, answer: { link: "https://www.figma.com/design/ab12.../Pricing?node-id=41-207" } }
 *   fw_resume { runId, answer: { summary: "...", steps: ["...", "..."], risks: "..." } }
 *   fw_resume { runId, answer: { approved: true, approver: "ricardo", note: "" } }
 *   fw_resume { runId, answer: { files: ["app/pricing/page.tsx"], notes: "..." } }
 */

// -- Types --

/** What the caller wants. The link itself is asked for at the first gate. */
interface PageRequest {
  goal: string;
}

/** A Figma link, taken apart. Produced only if the link really is one. */
interface FigmaRef {
  fileKey: string;
  nodeId: string;
  fileName: string;
}

/** One component instance as Figma reports it, before any library matching. */
interface FigmaInstance {
  instanceId: string;
  componentName: string;
  section: string;
  props: Record<string, string>;
}

/** The raw extraction: what the (simulated) Figma read returned. */
interface FigmaExtract {
  instances: FigmaInstance[];
  compositions: string[];
  tokens: Record<string, string>;
}

/** One resolved instance: a Figma instance bound to a real library component. */
interface MappedInstance {
  instanceId: string;
  section: string;
  /** The library component to import, or '' when nothing matched. */
  component: string;
  importPath: string;
  props: Record<string, string>;
}

/** The full match result. `unmatched` is the only part the agent hears about. */
interface Mapping {
  matched: MappedInstance[];
  unmatched: string[];
  tokenMap: Record<string, string>;
}

/** The small thing the planning agent sees. Deliberately counts, not contents. */
interface Digest {
  fileName: string;
  sections: string[];
  componentCount: number;
  distinctComponents: number;
  unmatched: string[];
  tokensResolved: number;
}

/** The agent's plan, after it has been checked for shape and for length. */
interface Plan {
  summary: string;
  steps: string[];
  risks: string;
}

/** What the human decided at the approval gate. */
interface Decision {
  approved: boolean;
  approver: string;
  note: string;
}

/** One section's worth of build orders, resolved down to the last prop. */
interface SectionSpec {
  section: string;
  instances: MappedInstance[];
}

/** Everything the building agent needs, assembled once, deterministically. */
interface BuildSpec {
  fileName: string;
  imports: string[];
  sections: SectionSpec[];
  tokenMap: Record<string, string>;
  omitted: string[];
}

// -- Nodes --

/**
 * Turns the request into the question to put to the user, and forwards the
 * goal. `waitForEvent` reads `eventName` and `match` from here via `[expr:]`,
 * so the gate needs no literals of its own.
 *
 * @flowWeaver nodeType
 * @expression
 * @label Ask For Link
 * @color blue
 * @icon help
 * @input request - What the caller wants built
 * @output eventName - Name of the event the answer arrives on
 * @output match - Field correlating the answer to this run
 * @output goal - The caller's goal, carried on
 */
export function askForLink(request: PageRequest): {
  eventName: string;
  match: string;
  goal: string;
} {
  return {
    eventName: 'figma/link.provided',
    match: 'data.goal',
    goal: request.goal,
  };
}

/**
 * Validates that what came back is a Figma link, and takes it apart.
 *
 * Normal mode on purpose: a wrong link is a routable outcome, not a crash --
 * the user pasted something, and the right answer is to tell them what was
 * wrong with it, not to abort. `eventData` is whatever the gate was resolved
 * with, so it is read defensively.
 *
 * The accepted shape is `figma.com/(file|design|proto)/<key>/<name>`, with an
 * optional `node-id`. A bare `figma.com` host with no file key is refused: it
 * is a link to Figma, not a link to a design.
 *
 * @flowWeaver nodeType
 * @durablePure
 * @label Parse Figma Link
 * @color purple
 * @icon link
 * @input eventData - The raw answer from the input gate
 * @input goal - The caller's goal
 * @output ref - The parsed Figma reference (on success)
 * @output goal - The caller's goal, carried on
 * @output rejection - Why the link was refused (on failure)
 */
export function parseFigmaLink(
  execute: boolean,
  eventData: Record<string, unknown>,
  goal: string,
): {
  onSuccess: boolean;
  onFailure: boolean;
  ref: FigmaRef;
  goal: string;
  rejection: string;
} {
  const empty: FigmaRef = { fileKey: '', nodeId: '', fileName: '' };
  if (!execute) {
    return { onSuccess: false, onFailure: false, ref: empty, goal, rejection: '' };
  }

  const link = typeof eventData?.link === 'string' ? eventData.link.trim() : '';
  if (link.length === 0) {
    return {
      onSuccess: false,
      onFailure: true,
      ref: empty,
      goal,
      rejection: 'no link supplied: expected { link: "https://www.figma.com/design/..." }',
    };
  }

  const match = /^https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)\/([^/?#]+)/.exec(
    link,
  );
  if (match === null) {
    return {
      onSuccess: false,
      onFailure: true,
      ref: empty,
      goal,
      rejection: `not a Figma design link: ${link.slice(0, 120)}`,
    };
  }

  const nodeMatch = /[?&]node-id=([0-9]+[-:][0-9]+)/.exec(link);
  return {
    onSuccess: true,
    onFailure: false,
    ref: {
      fileKey: match[1],
      nodeId: nodeMatch === null ? '0:1' : nodeMatch[1].replace(':', '-'),
      fileName: decodeURIComponent(match[2]).replace(/-/g, ' '),
    },
    goal,
    rejection: '',
  };
}

/**
 * SIMULATED Figma read. A real implementation would call the Figma REST API
 * here; the point of the demo is the shape of the data and where it flows, so
 * this returns a fixed payload keyed off nothing but the ref.
 *
 * This is the biggest object in the run -- 16 instances, 3 compositions and
 * 24 tokens -- and it is also the object the agent never sees. It exists only
 * to be reduced by `matchLibrary` and `buildDigest`.
 *
 * @flowWeaver nodeType
 * @expression
 * @label Extract Design (mock)
 * @color cyan
 * @icon search
 * @input ref - The parsed Figma reference
 * @input goal - The caller's goal
 * @output extract - Everything the file contains
 * @output ref - The reference, carried on
 * @output goal - The caller's goal, carried on
 */
export function extractDesign(
  ref: FigmaRef,
  goal: string,
): { extract: FigmaExtract; ref: FigmaRef; goal: string } {
  const sections = ['hero', 'tiers', 'faq'];
  const perSection: Record<string, Array<{ name: string; props: Record<string, string> }>> = {
    hero: [
      { name: 'Heading/Display', props: { level: '1', align: 'center' } },
      { name: 'Text/Lead', props: { tone: 'muted', align: 'center' } },
      { name: 'Button/Primary', props: { size: 'lg', label: 'Start free' } },
      { name: 'Button/Ghost', props: { size: 'lg', label: 'Talk to sales' } },
      { name: 'Badge/Pill', props: { tone: 'accent', label: 'New' } },
    ],
    tiers: [
      { name: 'Card/Pricing', props: { tier: 'starter', featured: 'false' } },
      { name: 'Card/Pricing', props: { tier: 'team', featured: 'true' } },
      { name: 'Card/Pricing', props: { tier: 'scale', featured: 'false' } },
      { name: 'List/Checks', props: { density: 'compact' } },
      { name: 'Button/Primary', props: { size: 'md', label: 'Choose plan' } },
      { name: 'Toggle/BillingPeriod', props: { options: 'monthly,yearly' } },
    ],
    faq: [
      { name: 'Heading/Section', props: { level: '2', align: 'left' } },
      { name: 'Accordion/Item', props: { defaultOpen: 'true' } },
      { name: 'Accordion/Item', props: { defaultOpen: 'false' } },
      { name: 'Accordion/Item', props: { defaultOpen: 'false' } },
      { name: 'Text/Body', props: { tone: 'muted', align: 'left' } },
    ],
  };

  const instances: FigmaInstance[] = [];
  for (const section of sections) {
    const entries = perSection[section];
    for (let i = 0; i < entries.length; i++) {
      instances.push({
        instanceId: `${section}-${i + 1}`,
        componentName: entries[i].name,
        section,
        props: entries[i].props,
      });
    }
  }

  return {
    ref,
    goal,
    extract: {
      instances,
      compositions: sections,
      tokens: {
        'color/bg/surface': '#0B0D10',
        'color/bg/raised': '#14181D',
        'color/fg/default': '#E6E8EB',
        'color/fg/muted': '#9AA3AD',
        'color/accent/default': '#4C8DFF',
        'color/accent/hover': '#3D74D6',
        'space/1': '4px',
        'space/2': '8px',
        'space/3': '12px',
        'space/4': '16px',
        'space/6': '24px',
        'space/8': '32px',
        'radius/sm': '6px',
        'radius/md': '10px',
        'radius/lg': '16px',
        'font/size/display': '48px',
        'font/size/lead': '20px',
        'font/size/body': '15px',
        'font/weight/regular': '400',
        'font/weight/medium': '500',
        'font/weight/bold': '700',
        'shadow/sm': '0 1px 2px rgba(0,0,0,.4)',
        'shadow/md': '0 6px 20px rgba(0,0,0,.35)',
        'motion/fast': '120ms',
      },
    },
  };
}

/**
 * SIMULATED component-library match. A real implementation would read the
 * library manifest; here the table is inline.
 *
 * This is the node that earns the whole design. It resolves every instance to
 * a real component and import path, and rewrites the token names to CSS
 * variables, so that by the time either agent is woken there is nothing left
 * to look up. `Toggle/BillingPeriod` has no counterpart in the library on
 * purpose -- an unmatched component is exactly the kind of thing worth
 * spending agent attention on, and it is what `buildDigest` surfaces.
 *
 * @flowWeaver nodeType
 * @expression
 * @label Match Library (mock)
 * @color green
 * @icon link
 * @input extract - Everything the file contains
 * @input ref - The parsed Figma reference
 * @input goal - The caller's goal
 * @output mapping - Instances resolved against the library
 * @output ref - The reference, carried on
 * @output goal - The caller's goal, carried on
 */
export function matchLibrary(
  extract: FigmaExtract,
  ref: FigmaRef,
  goal: string,
): { mapping: Mapping; ref: FigmaRef; goal: string } {
  const library: Record<string, { component: string; importPath: string }> = {
    'Heading/Display': { component: 'Heading', importPath: '@ui/typography' },
    'Heading/Section': { component: 'Heading', importPath: '@ui/typography' },
    'Text/Lead': { component: 'Text', importPath: '@ui/typography' },
    'Text/Body': { component: 'Text', importPath: '@ui/typography' },
    'Button/Primary': { component: 'Button', importPath: '@ui/button' },
    'Button/Ghost': { component: 'Button', importPath: '@ui/button' },
    'Badge/Pill': { component: 'Badge', importPath: '@ui/badge' },
    'Card/Pricing': { component: 'PricingCard', importPath: '@ui/pricing-card' },
    'List/Checks': { component: 'CheckList', importPath: '@ui/list' },
    'Accordion/Item': { component: 'AccordionItem', importPath: '@ui/accordion' },
  };

  // Figma variant names collapse onto one component, so the variant has to
  // survive as a prop or the distinction is lost in the generated page.
  const variantOf: Record<string, string> = {
    'Heading/Display': 'display',
    'Heading/Section': 'section',
    'Text/Lead': 'lead',
    'Text/Body': 'body',
    'Button/Primary': 'primary',
    'Button/Ghost': 'ghost',
  };

  const matched: MappedInstance[] = [];
  const unmatched: string[] = [];

  for (const instance of extract.instances) {
    const hit = library[instance.componentName];
    if (hit === undefined) {
      if (!unmatched.includes(instance.componentName)) {
        unmatched.push(instance.componentName);
      }
      continue;
    }
    const variant = variantOf[instance.componentName];
    matched.push({
      instanceId: instance.instanceId,
      section: instance.section,
      component: hit.component,
      importPath: hit.importPath,
      props: variant === undefined ? instance.props : { variant, ...instance.props },
    });
  }

  // Design tokens become the CSS variables the library actually reads.
  const tokenMap: Record<string, string> = {};
  for (const [name, value] of Object.entries(extract.tokens)) {
    tokenMap[`--${name.replace(/\//g, '-')}`] = value;
  }

  return { ref, goal, mapping: { matched, unmatched, tokenMap } };
}

/**
 * Reduces the mapping to the few facts a plan actually turns on: how much
 * there is, how it is divided, and what did not resolve. Counts, not contents.
 *
 * This node is the token budget. Whatever the extraction grows to, the
 * planning gate's payload stays this size, because the gate reads its context
 * from here and from nowhere else.
 *
 * @flowWeaver nodeType
 * @expression
 * @label Build Digest
 * @color yellow
 * @icon summarize
 * @input mapping - Instances resolved against the library
 * @input ref - The parsed Figma reference
 * @input goal - The caller's goal
 * @output digest - The small summary the planning agent sees
 * @output agentId - Names the planning task
 * @output prompt - What the planning agent should do
 * @output mapping - The mapping, carried on for the aggregate step
 */
export function buildDigest(
  mapping: Mapping,
  ref: FigmaRef,
  goal: string,
): { digest: Digest; agentId: string; prompt: string; mapping: Mapping } {
  const sections: string[] = [];
  const distinct: string[] = [];
  for (const instance of mapping.matched) {
    if (!sections.includes(instance.section)) sections.push(instance.section);
    if (!distinct.includes(instance.component)) distinct.push(instance.component);
  }

  const digest: Digest = {
    fileName: ref.fileName,
    sections,
    componentCount: mapping.matched.length,
    distinctComponents: distinct.length,
    unmatched: mapping.unmatched,
    tokensResolved: Object.keys(mapping.tokenMap).length,
  };

  return {
    digest,
    mapping,
    agentId: 'figma-page-plan',
    prompt:
      `Goal: ${goal}\n` +
      'The design has already been extracted and matched to the component library; ' +
      'the digest is the whole picture. Do not ask to see the design.\n' +
      'Reply with { summary: string, steps: string[], risks: string }. ' +
      'At most 4 steps, each under 120 characters, summary under 200. ' +
      'Say how you would handle the unmatched components. Be terse; a long plan is rejected.',
  };
}

/**
 * Checks the plan, and enforces the token budget in code.
 *
 * The prompt asks for brevity; this node is what makes brevity binding. An
 * over-long plan is refused the same way a malformed one is, and the refusal
 * names the limit that was broken, so a retry has something to aim at. Asking
 * an agent to be brief and then accepting whatever arrives is how a budget
 * becomes a suggestion.
 *
 * Normal mode: a bad plan is routable, not fatal. `agentResult` is unchecked
 * JSON and is read defensively.
 *
 * @flowWeaver nodeType
 * @durablePure
 * @label Check Plan
 * @color green
 * @icon shield
 * @input agentResult - The unchecked plan from the agent gate
 * @input mapping - Instances resolved against the library
 * @output plan - The validated plan (on success)
 * @output mapping - The mapping, carried on
 * @output rejection - Why the plan was refused (on failure)
 */
export function checkPlan(
  execute: boolean,
  agentResult: Record<string, unknown>,
  mapping: Mapping,
): {
  onSuccess: boolean;
  onFailure: boolean;
  plan: Plan;
  mapping: Mapping;
  rejection: string;
} {
  const empty: Plan = { summary: '', steps: [], risks: '' };
  if (!execute) {
    return { onSuccess: false, onFailure: false, plan: empty, mapping, rejection: '' };
  }

  const refuse = (rejection: string) => ({
    onSuccess: false,
    onFailure: true,
    plan: empty,
    mapping,
    rejection,
  });

  const summary = agentResult?.summary;
  const steps = agentResult?.steps;
  const risks = agentResult?.risks;

  if (typeof summary !== 'string' || summary.length === 0) {
    return refuse('malformed plan: summary must be a non-empty string');
  }
  if (!Array.isArray(steps) || steps.length === 0 || steps.some((s) => typeof s !== 'string')) {
    return refuse('malformed plan: steps must be a non-empty array of strings');
  }
  if (typeof risks !== 'string') {
    return refuse('malformed plan: risks must be a string');
  }

  // The budget, enforced rather than requested.
  if (summary.length > 200) {
    return refuse(`plan too long: summary is ${summary.length} characters, limit is 200`);
  }
  if (steps.length > 4) {
    return refuse(`plan too long: ${steps.length} steps, limit is 4`);
  }
  const overrun = (steps as string[]).findIndex((s) => s.length > 120);
  if (overrun !== -1) {
    return refuse(
      `plan too long: step ${overrun + 1} is ${(steps as string[])[overrun].length} characters, limit is 120`,
    );
  }

  return {
    onSuccess: true,
    onFailure: false,
    plan: { summary, steps: steps as string[], risks },
    mapping,
    rejection: '',
  };
}

/**
 * The human gate. The user accepts or refuses the plan before any page is
 * built.
 *
 * It takes the plan and nothing else. Passing the mapping through here would
 * be the obvious way to get it to `spec`, and it would be a mistake: a gate's
 * inputs are serialized into the continuation, so routing the mapping through
 * this node would put the very table this design keeps away from the gates
 * into the payload of one, for a reader who only needs the plan. `spec` reads
 * the mapping from `check` across the gate instead, which is allowed because
 * `spec` is not itself a gate.
 *
 * The body is never called -- reaching it means the gate boundary was not
 * applied, which is why it throws rather than returning something plausible.
 * Normal mode is required: the resolution supplies `onSuccess`/`onFailure`
 * alongside the outputs. On a rejection the `decision` output is nulled, so
 * every reader guards for null.
 *
 * @flowWeaver nodeType
 * @durableGate approval
 * @label Approve Plan
 * @color orange
 * @icon verified
 * @input plan - The validated plan
 * @output decision - What the user decided
 */
export async function approvePlan(
  execute: boolean,
  plan: Plan,
): Promise<{ onSuccess: boolean; onFailure: boolean; decision: Decision }> {
  throw new Error(`durable approval gate must not execute: ${execute}:${plan.summary}`);
}

/**
 * The aggregation step: everything the building agent will need, assembled
 * from values already in hand. No I/O, no lookups left over, nothing deferred.
 *
 * It groups the resolved instances by section in source order, derives the
 * exact import lines, and passes the token map through. What comes out is not
 * a description of the work -- it is the work, minus the typing. The agent's
 * remaining job is to render it, which is the one part a program cannot do.
 *
 * `omitted` carries the unmatched names forward rather than dropping them: the
 * agent has to know what is missing from the spec, or it will silently ship a
 * page with a hole in it.
 *
 * @flowWeaver nodeType
 * @expression
 * @label Aggregate Build Spec
 * @color cyan
 * @icon inventory
 * @input mapping - Instances resolved against the library
 * @input plan - The approved plan
 * @input ref - The parsed Figma reference
 * @output spec - Everything the building agent needs
 * @output agentId - Names the build task
 * @output prompt - What the building agent should do
 */
export function aggregateBuildSpec(
  mapping: Mapping,
  plan: Plan,
  ref: FigmaRef,
): { spec: BuildSpec; agentId: string; prompt: string } {
  // Group by section, preserving the order the sections first appear in.
  const order: string[] = [];
  const bySection: Record<string, MappedInstance[]> = {};
  for (const instance of mapping.matched) {
    if (bySection[instance.section] === undefined) {
      bySection[instance.section] = [];
      order.push(instance.section);
    }
    bySection[instance.section].push(instance);
  }

  // One import line per module, with its components de-duplicated and sorted
  // so the generated page is stable across runs.
  const byModule: Record<string, string[]> = {};
  for (const instance of mapping.matched) {
    const names = byModule[instance.importPath] ?? (byModule[instance.importPath] = []);
    if (!names.includes(instance.component)) names.push(instance.component);
  }
  const imports = Object.keys(byModule)
    .sort()
    .map((path) => `import { ${byModule[path].sort().join(', ')} } from '${path}';`);

  return {
    agentId: 'figma-page-build',
    spec: {
      fileName: ref.fileName,
      imports,
      sections: order.map((section) => ({ section, instances: bySection[section] })),
      tokenMap: mapping.tokenMap,
      omitted: mapping.unmatched,
    },
    prompt:
      `Build "${ref.fileName}". Approved plan: ${plan.summary}\n` +
      'The spec is complete and resolved: components, import paths and props are final. ' +
      'Use them exactly as given -- do not rename, substitute or re-derive anything, and do not ask for the design.\n' +
      'Render sections in the given order. Apply tokenMap as CSS variables. For anything in omitted, leave a TODO comment naming it.\n' +
      'Reply with { files: string[], notes: string }.',
  };
}

/**
 * Writes down how the run ended, on every arm that can reach it.
 *
 * It is reached three ways: a refused link, a refused plan, or a completed
 * build -- so every input is optional and the node decides the status from
 * what actually arrived rather than from where it was called.
 *
 * The two refusals arrive on separate ports rather than merging onto one.
 * They cannot both be set -- a run that never got a valid link never reached
 * the planning gate -- so a merge would only be hiding which arm ran, and the
 * first non-empty one is the answer either way.
 *
 * @flowWeaver nodeType
 * @expression
 * @durablePure
 * @label Report
 * @icon checkCircle
 * @input linkRejection - Why the link was refused, if it was
 * @input planRejection - Why the plan was refused, if it was
 * @input decision - What the user decided, if they were asked
 * @input buildResult - What the building agent reported, if it ran
 * @output status - How the run ended
 * @output outcome - The human-readable account
 */
export function report(
  linkRejection: string,
  planRejection: string,
  decision: Decision | null,
  buildResult: Record<string, unknown> | null,
): { status: string; outcome: string } {
  const rejection = [linkRejection, planRejection].find(
    (r) => typeof r === 'string' && r.length > 0,
  );
  if (rejection !== undefined) {
    return { status: 'refused', outcome: rejection };
  }

  // A rejected approval gate nulls its `decision` output, so a missing
  // decision is a refusal rather than something to destructure.
  const { approved, approver, note } = decision ?? { approved: false, approver: '', note: '' };
  if (!approved) {
    return {
      status: 'declined',
      outcome: `plan declined by ${approver || 'unknown'}${note ? ` -- "${note}"` : ''}`,
    };
  }

  const files = Array.isArray(buildResult?.files)
    ? (buildResult.files as unknown[]).filter((f): f is string => typeof f === 'string')
    : [];
  const notes = typeof buildResult?.notes === 'string' ? buildResult.notes : '';

  return {
    status: files.length > 0 ? 'built' : 'nothing-built',
    outcome: [
      `approved by ${approver || 'unknown'}`,
      files.length > 0 ? `files: ${files.join(', ')}` : 'no files reported',
      notes ? `notes: ${notes}` : '',
    ]
      .filter((line) => line.length > 0)
      .join('\n'),
  };
}

// -- Workflow --

/**
 * The spine is linear: `@path` wires the name-matched chain from `Start`
 * through to `build`, so each gate is driven from its immediate predecessor's
 * success arm and therefore sits in exactly one branch region, which is what
 * the continuation needs in order to replay.
 *
 * `spec` takes its mapping from `check` explicitly rather than from `@path`,
 * which would have taken it from `approve`. That is the whole point of the
 * connection: the mapping skips the approval gate instead of riding through
 * it, so the largest object in the run never enters a gate payload. `spec` is
 * not a gate, so it may read across one.
 *
 * `finish` is wired on three arms rather than by `@path` alone, because all
 * three can end the run: a refused link (`parse:fail`), a refused plan
 * (`check:fail`), and a completed build. Driving it from `build` alone --
 * what `@path` would do -- would leave the two rejection arms with no result.
 *
 * The two refusals reach `finish` on separate ports, `linkRejection` and
 * `planRejection`, because only one can ever be set: a run that failed to
 * parse its link never reached the planning gate.
 *
 * `extract` suppresses `AGENT_UNGUARDED_TOOL_EXECUTOR`: the rule wants an
 * approval gate ahead of a tool executor, but this one only reads a design
 * file. The approval this workflow needs guards the build, not the read, and
 * gating the read would spend a human's attention on nothing.
 *
 * The gate failure arms (`link`, `approve`, `build`) are left unwired on
 * purpose: wiring them would put those gates in a second branch region. A
 * rejected approval still reaches `finish`, because `finish` reads `decision`
 * as a value and a rejection nulls it.
 *
 * @flowWeaver workflow
 * @param request - What the caller wants built
 * @returns status - How the run ended
 * @returns outcome - The human-readable account
 * @node ask askForLink [position: -960 0]
 * @node link waitForEvent [expr: eventName="ask.eventName", match="ask.match", timeout="'24h'"] [suppress: "DESIGN_ASYNC_NO_ERROR_PATH"] [position: -780 0]
 * @node parse parseFigmaLink [position: -600 0]
 * @node extract extractDesign [suppress: "AGENT_UNGUARDED_TOOL_EXECUTOR"] [position: -420 0]
 * @node match matchLibrary [position: -240 0]
 * @node digest buildDigest [position: -60 0]
 * @node plan waitForAgent [expr: agentId="digest.agentId", context="digest.digest", prompt="digest.prompt"] [suppress: "DESIGN_ASYNC_NO_ERROR_PATH"] [position: 120 0]
 * @node check checkPlan [position: 300 0]
 * @node approve approvePlan [suppress: "DESIGN_ASYNC_NO_ERROR_PATH"] [position: 480 0]
 * @node spec aggregateBuildSpec [position: 660 0]
 * @node build waitForAgent [expr: agentId="spec.agentId", context="spec.spec", prompt="spec.prompt"] [suppress: "DESIGN_ASYNC_NO_ERROR_PATH"] [position: 840 0]
 * @node finish report [position: 1040 0]
 * @path Start -> ask -> link -> parse -> extract -> match -> digest -> plan -> check -> approve -> spec -> build -> Exit
 * @path parse:fail -> finish -> Exit
 * @path check:fail -> finish
 * @path build -> finish
 * @connect link.eventData -> parse.eventData
 * @connect plan.agentResult -> check.agentResult
 * @connect check.mapping -> spec.mapping
 * @connect parse.rejection -> finish.linkRejection
 * @connect check.rejection -> finish.planRejection
 * @connect approve.decision -> finish.decision
 * @connect build.agentResult -> finish.buildResult
 * @connect finish.status -> Exit.status
 * @connect finish.outcome -> Exit.outcome
 * @position Start -1140 0
 * @position Exit 1240 0
 */
export async function figmaToPage(
  execute: boolean,
  params: { request: PageRequest },
): Promise<{ onSuccess: boolean; onFailure: boolean; status: string; outcome: string }> {
  throw new Error('generated body was not installed');
}
