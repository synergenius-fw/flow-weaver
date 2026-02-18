UNIVERSAL FLOW WEAVER TEMPLATE GENERATION PROMPT (FINAL)

You are generating a Flow Weaver workflow template.
This template must be production-oriented, reusable, domain-agnostic, and optimized for clarity in both code and visual workflow form.

Do not create a demo, tutorial, or minimal example.
Create a complete, extensible template that developers can realistically start from and evolve.

You must assume:

The template may be used in real systems.

The template may be copied verbatim.

The workflow graph is a first-class artifact, not a side effect.

The same prompt may be reused to create templates for AI agents, data pipelines, backend services, integrations, infra orchestration, or other domains.

Do not explain your design decisions.
Do not include commentary, markdown explanations, or examples outside the generated template.

GLOBAL DESIGN PRINCIPLES

Prefer explicitness over convenience

Prefer structural clarity over brevity

Prefer typed contracts over dynamic behavior

Prefer state transitions over ad-hoc variable passing

Prefer deterministic flow over hidden side effects

The template must clearly communicate:

What happens

In what order

Under which conditions

Why execution continues or stops

1. TEMPLATE OUTPUT REQUIREMENTS

The generator must return a single self-contained TypeScript file that:

Compiles only via Flow Weaver tooling

Contains:

Domain types

State models

Node definitions

Workflow definition

Avoids external dependencies unless strictly necessary

Uses placeholder or mock implementations where integration is required

2. STATE MODELING (MANDATORY)

You must define a single primary state object (e.g., WorkflowState, AgentState, ProcessState).

State must include, when applicable:

Current step or iteration

Accumulated outputs/results

Operational metadata (timestamps, counters, identifiers)

Error information (structured, not strings only)

Termination flags and termination reason

Final output payload

State must:

Be immutable in intent (new state emitted, not mutated in place)

Flow through the entire workflow

Be inspectable at every node boundary

3. NODE DESIGN REQUIREMENTS

Each node must:

Have exactly one primary responsibility

Accept explicit inputs (no hidden globals)

Emit explicit outputs

Return both success and failure signals

Never throw uncaught errors

Be meaningful as a standalone building block

Each node must:

Be annotated with @flowWeaver nodeType

Have a human-readable @label

Declare all inputs and outputs clearly

Avoid side effects outside its declared responsibility

4. CONTROL FLOW AND BRANCHING

All control flow must be explicit and visible in the workflow graph.

Required patterns:

Success vs failure branching

Conditional continuation (e.g., shouldContinue)

Explicit termination signaling

Safety guards (iteration limits, timeouts, max retries)

Avoid:

Implicit control flow via booleans without context

Early returns that bypass workflow logic

Hidden termination conditions

5. LOOPING AND ITERATION (IF APPLICABLE)

If the domain involves repetition:

Loops must be represented as visible cycles in the workflow

Loop state must be tracked explicitly

Continuation conditions must be explicit outputs

Termination must produce a reason (enum or tagged union)

Safety limits must be enforced

6. ERROR HANDLING (MANDATORY)

Errors must:

Be structured (error type, message, source)

Flow through the state model

Be observable in the workflow

Never rely solely on thrown exceptions

The workflow must support:

Error propagation

Error-based termination

Optional recovery or retry paths

7. DOMAIN EXTENSIBILITY

The template must be designed so that developers can:

Add new nodes without refactoring existing ones

Extend the state model without breaking flow

Swap implementations (e.g., providers, adapters)

Introduce new branching paths

Avoid:

Hard-coded domain assumptions

Monolithic logic blocks

Tight coupling between nodes

8. WORKFLOW DEFINITION REQUIREMENTS

The workflow section must:

Declare all nodes explicitly

Declare all connections explicitly

Make execution order visually obvious

Include Start and Exit semantics

Wire state transitions clearly

Expose final outputs intentionally

The graph must:

Clearly show the “happy path”

Clearly show failure paths

Clearly show loop-back paths (if any)

9. TERMINATION SEMANTICS

Termination must be explicit and structured.

The workflow must distinguish between:

Successful completion

Controlled early termination

Safety-based termination

Error-based termination

Termination reason must be:

Encoded in state

Observable at workflow exit

Machine-readable (enum or tagged union)

10. TEMPLATE QUALITY BAR

The final template must:

Look credible to senior engineers

Scale conceptually beyond trivial use cases

Be understandable without documentation

Encourage correct Flow Weaver usage by design

Make misuse difficult or obvious

The template should feel like:

“This is how workflows are meant to be built in Flow Weaver.”

FINAL INSTRUCTION

Generate only the template code output.
Do not include explanations, comments about design decisions, or meta text.
The output must be a complete Flow Weaver workflow template that satisfies all requirements above, adapted to the target domain provided.

If any requirement conflicts, prefer:
explicitness → observability → safety → extensibility → convenience