# 0001. Durable continuation yields only at explicit gates

**Status:** accepted
**Date:** 2026-07-26
**Scope:** the next major Flow Weaver execution contract

## Context

Stitch needs a workflow process to release every operating system resource
while an approval, input request, or agent response is outstanding. A process
may die after the gate is made durable, and another process must resume without
repeating a committed side effect.

The existing debugger checkpoint is not this facility. It writes beside a
source file, parses JSON into a TypeScript type without a strict wire decoder,
invokes function-valued variables while serializing, identifies completed work
primarily by node id, and resumes by skipping nodes. It is injected through
process-global state. Those properties are useful for local debugging and are
unsafe as a durable multi-run protocol.

JavaScript stacks, promises, handles, iterators, closures, and arbitrary
third-party node state cannot be serialized safely. A continuation therefore
cannot be an arbitrary suspension point.

## Decision

### Yield is an explicit terminal outcome for one execution segment

The replacement executor returns one of two outcomes:

```ts
type ExecutionOutcome =
  | { readonly kind: "completed"; readonly result: unknown }
  | {
      readonly kind: "yielded";
      readonly gate: GateRequest;
      readonly continuation: ContinuationEnvelope;
    };
```

A yielded segment has ended. It retains no process, promise, timer, open
transport, agent stream, or concurrency slot. Resuming starts a new segment
from a decoded continuation.

Only compiler-known approval, input, and agent gate node types may yield.
Yield occurs between node effects, after all predecessor state has been
committed to the execution context and before any successor begins. An agent
gate may yield before a model turn or after a complete turn and its durable
receipts. It may not yield during token streaming or during a tool call.

For any reachable workflow closure containing a gate, every node has exactly
one compiler classification: pure/orchestration, gate, or effect. Unknown or
contradictory local and external definitions are refused at compile time,
including scoped children and sibling workflow invocations.

The engine returns the envelope to its caller. It never writes the production
continuation to a file or database. The coordinator must commit the
continuation and gate record atomically before it acknowledges the yield.

### The envelope is a strict bounded wire value

The first format is a closed record with these fields:

| Field                | Meaning                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `formatVersion`      | Literal `1`                                                               |
| `runId` and `gateId` | Exact identities supplied by the authorized caller                        |
| `gateKind`           | `approval`, `input`, or `agent`                                           |
| `workflowId`         | Canonical workflow identity                                               |
| `bundleDigest`       | Coordinator-verified `sha256:<64hex>` identity of the complete executable bundle closure |
| `graphFingerprint`   | Bare 64-hex SHA-256 of the canonical compiled graph                       |
| `engineVersion`      | Exact Flow Weaver version that yielded                                    |
| `generatorAbi`       | Exact generated-function ABI identifier                                   |
| `location`           | Exact nested execution address and next safe boundary                     |
| `state`              | Variables, execution counters, branches, loops, scopes, and nested frames |
| `receipts`           | Committed effect receipts keyed by exact execution address                |
| `createdAt`          | ISO 8601 UTC timestamp for diagnosis, not ordering                        |
| `checksum`           | SHA-256 over canonical bytes of every other field                         |

Unknown and missing fields are refused. Every number must be finite. Allowed
values are null, booleans, finite numbers, strings, arrays, and plain records.
Undefined, bigint, symbol, functions, promises, class instances, dates, maps,
sets, buffers, typed arrays, accessors, cycles, and non-finite numbers are
refused. Serialization never invokes a value.

The encoded UTF-8 envelope is limited to 1 MiB. Nesting is limited to 32,
aggregate array and record entries to 10,000, and one string to 256 KiB.
The decoder checks bounds while walking unknown input and before retaining a
second representation. A limit change requires a reviewed format decision.

### Execution addresses are structural and exact

A node id is not an execution address. The address contains:

- the workflow frame, including nested workflow invocation index
- the node instance id and its execution index
- the complete scope ancestry
- each loop container execution and iteration ordinal
- each active branch and branch arm, qualified by owning workflow and frame depth
- the next compiler-known boundary

Variables and receipts are keyed by this address plus port name. Resume does
not search for a similar node, infer a current iteration, or skip every node
sharing an id.

### External effects need idempotency and receipts

An effectful node must receive a stable operation key derived from the run id
and exact execution address. Automatic resume is permitted only when the
adapter can either:

- prove the operation did not commit
- return the durable receipt for the already committed operation
- safely repeat the operation under the same idempotency key

The receipt becomes part of the continuation before a later boundary may
yield. If a process dies after an external system may have acted but before
the receipt is durable, the engine reports an ambiguous effect. It does not
rerun the node. The coordinator records the run as interrupted and applies an
explicit policy or asks an operator.

Exactly-once behavior is never inferred from retained output values.

### Execution state is scoped to one run

Events, cancellation, gates, agent communication, mocks, workflow lookup, and
continuation state are passed through an execution-scoped context. The
production executor does not discover them on `globalThis`.

A Stitch executor will also isolate each run in its own process. That process
boundary provides preemption for non-cooperative code, but it does not excuse
cross-run globals in the engine contract. Other first-party callers execute
more than one run in one process and must remain isolated.

### Standard Node.js is the runtime contract

The engine, generated workflow ABI, continuation envelope, cancellation
contract, and executor protocol run in a standard Node.js process. The
supported range starts at Node.js 22, matching this package's `engines`
declaration. Every supported Node.js major in that declared range must pass
the same executor and continuation corpus before release.

The continuation uses only the bounded plain wire values defined above. It
contains no V8 snapshot, native handle, process id, filesystem path, Electron
object, renderer or main-process state, or operating-system serialization.
A continuation may resume on a different compatible Node executor when its
engine, generator, workflow, bundle, and graph identities match.

The executor never derives `bundleDigest` from the workflow source file:
imports and other executable dependencies may change independently. Durable
yield and resume require verified whole-bundle evidence from the coordinator.
The distinct graph fingerprint is a canonical digest of the full reachable
workflow closure. Dynamic local invocation conservatively includes every
workflow in the source bundle.

Format 1 does not execute durable-capable graph lanes concurrently. Generation
is sequential for any closure containing a gate, ensuring a terminal yield has
no live sibling lane. Parallel durable execution requires a later explicit
cancellation and all-settled contract.

Format 1 refuses every generated scope callback in a closure containing a
durable gate. The scope owner is ordinary node code and may repeat or call its
callback concurrently, so sequential outer generation is not proof of settled
lanes or independently authenticated execution ordinals. A later format may
admit this topology only with explicit ordinal, cancellation, and all-settled
contracts.

Consequently every accepted Format 1 frame invocation, caller execution, node
execution, and branch-owner execution ordinal is zero. Any other ordinal is
refused by the decoder before effect re-attestation or node execution.

The same fail-closed closure validation is intrinsic to every public generation
entry point. Durable-gate closures also refuse pull or lazy execution, whose
optional predecessors cannot form a complete prefix, and durable boundaries
after branch convergence, where the selected arm is no longer present in the
boundary address. Gates inside an active branch retain that exact branch path
and remain supported.

Dynamic local invocation carries the generated recursion depth across registry
calls and refuses depth 1,000. Conservative closure inclusion terminates over
a visited workflow set during compile and preflight, while runtime self or
mutual invocation cycles remain strictly bounded.

Electron is one trusted Node executor implementation. It may provide native
brokers and a per-run process boundary. Neither the engine nor the envelope
imports or names Electron APIs.

Every workflow declares its runtime requirements. An empty broker set means
portable and permits execution on any compatible Node executor. Local files,
native credentials, scanners, supervised browser work, and other native
facilities are named as explicit broker requirements. The host allocates a run
only to an executor advertising every required broker. A missing broker is a
preflight refusal before a process or concurrency slot is allocated.

Broker handles never enter a continuation. Durable state may contain a bounded
opaque broker receipt whose schema is part of that broker's versioned
contract. Resumption reacquires a broker through the executor protocol.

### Compatibility is exact and refusal is normal

Format `1` resumes only when all of these match exactly:

- continuation format
- engine version
- generator ABI
- workflow id
- bundle digest
- graph fingerprint

There is no compatibility range and no best-effort state migration in the
first format. Patch releases may read a continuation only when they preserve
the exact recorded engine identifier by design, which means a normal release
does not. Active and queued Stitch runs keep their pinned engine and bundle.

The decoder returns a typed refusal before execution. Stable refusal reasons
include malformed, oversized, unsupported-format, incompatible-engine,
incompatible-generator, wrong-workflow, wrong-bundle, wrong-graph,
checksum-mismatch, stale-gate, wrong-run, and ambiguous-effect.

Address comparisons, gate ids, operation keys, duplicate detection, and state
ownership all use the same canonical structural encoding. Object property
order introduced by JSONB or another canonical store cannot change identity.
Completed state must be a strict compiled execution prefix before the recorded
gate. The compatibility manifest names every required predecessor together
with its compiled branch path, and every graph node declares its exact active
transitive compiled branch path, so an omitted ancestor branch or missing
active predecessor is refused as well as a future completion. Branch
ownership is workflow- and frame-qualified, so repeated node ids across nested
or recursive workflow frames cannot alias. The decoder compares the observed
branch path with the compiled boundary path at every workflow frame, not only
the terminal gate frame. Nested frames must match a declared caller target,
scopes and branch arms must belong to the compiled graph, and only outputs of
completed nodes may be retained as variables. The decoder
returns a deeply frozen clone so caller mutation after validation cannot alter
runtime state. Every public runtime construction path likewise clones and
freezes a validated gate resolution before asynchronous preflight and binds an
accepted continuation to its exact run and root workflow before exposing a
runtime.
Every claimed completed effect is re-attested through its operation-key
adapter and the same exact closed recovery decoder before workflow code starts.

Rollback is mechanical. Stitch retains the prior engine artifact while runs
pin it. An older decoder refuses a newer format. It never guesses, truncates,
drops unknown fields, or falls back to the debugger checkpoint.

### Cancellation remains a separate change

AbortSignal forwarding changes the uninterrupted executor path and lands in
its own reviewed change. Cancellation checks do not create a continuation
boundary and do not imply that third-party code is preemptible.

## Crash contract

The durable continuation tests must cover process death:

1. before a gate yield is produced
2. after yield is produced but before the coordinator commits it
3. after the continuation and gate commit but before acknowledgement
4. before gate resolution
5. after gate resolution but before resume claim
6. during resume before the next effect
7. after an external effect but before its receipt commit
8. after its receipt commit

Only cases with a committed continuation and an unambiguous effect history may
resume automatically. Duplicate, reordered, stale, corrupt, cross-run,
cross-workflow, and cross-engine resumes are refusals.

The portability gate runs the corpus in a plain Node.js child process with no
Electron globals. The later native-executor phase adds an Electron adapter
test against the same protocol. Passing the Electron adapter never substitutes
for passing plain Node.js.

## Rejected alternatives

**Promote the debugger checkpoint.** Rejected because its serializer, file
ownership, node-id skip model, global injection, and permissive decoder do not
meet the wire or concurrency contract.

**Replay from the beginning.** Rejected because retained outputs do not prove
that an external side effect is safe to repeat.

**Serialize arbitrary JavaScript execution.** Rejected because the engine
cannot safely encode stacks, closures, promises, and native handles.

**Keep old and new executors together.** Rejected. The replacement is one
major-version cutover. First-party callers and generated artifacts migrate in
the coordinated release, then the old executor, checkpoint resume path,
overloads, globals, and superseded tests are deleted.

## Consequences

Compiler work must model execution addresses, branch and loop state, and gate
boundaries explicitly. Effect adapters gain an idempotency and receipt
contract. Some runs become interrupted instead of being silently retried.

The benefit is the property Stitch requires: a gate survives process loss,
resumption starts from an exact state, paused runs cost no process, and an
ambiguous external effect is never repeated automatically.
