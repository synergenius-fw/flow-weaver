# Trace: Duplicate @fwImport Bug

## Symptom
Adding an npm node type via browser modal produces 3 identical `@fwImport` entries.

## Call Chain
```
Stage.tsx onSelect()
  → addNodeType(nodeType, nodeTypeUI)              [addNodeType.ts:25]
    → executeOptimistic(mutationFn, optimisticUpdate)  [optimisticMutations.ts:79]
      → serviceLayer.call('addNodeTypeInWorkflow', ...)   [addNodeType.ts:85]
        → mutateWorkflowFile(...)                           [fileSystemWorker.ts:620]
          → parser.parse(filePath, externalNodeTypes)         [parser.ts:222]
          → addNodeType(workflow, npmType)                     [node-types.ts:35]
          → merge importSource (lines 660-687)
          → generateInPlace(sourceCode, workflowForGeneration) [generate-in-place.ts:68]
            → replaceWorkflowJSDoc(result, ast)                  [generate-in-place.ts:1156]
              → generateWorkflowJSDoc(ast)                         [generate-in-place.ts:1217]
                → ast.nodeTypes.filter(nt => nt.importSource)        [line 1239]
                → writes @fwImport for EACH type with importSource
          → fs.writeFile(filePath, result.code)
  → addNode(x, y, type, ...)                       [addNode.ts:91]
    → executeOptimistic(mutationFn, optimisticUpdate)
      → serviceLayer.call('addNodeToWorkflow', ...)
        → mutateWorkflowFile(...)
          → (same chain as above, but with addNode mutator)

(A third write happens from any subsequent mutation or background sync)
```

## Data Flow at Each Write

### Write 1: addNodeTypeInWorkflow
```
File state: 0 @fwImport
Parser input:
  - availableNodeTypes: [...tsFnTypes, externalType{name:'npm/acorn/parseExpressionAt', importSource:undefined}]
  - importedNpmNodeTypes: [] (no @fwImport in file)
  - workflowNodeTypes = [...availableNodeTypes, []] → 1 npm entry (no importSource)

Mutator: addNodeType() finds external entry, sets importSource='acorn'
  → updatedWorkflow.nodeTypes has 1 npm entry with importSource

Merge: nothing to merge (no parsed importSource)
generateWorkflowJSDoc: 1 type with importSource → writes 1 @fwImport

File state: 1 @fwImport ✓
```

### Write 2: addNodeToWorkflow
```
File state: 1 @fwImport
Parser input:
  - availableNodeTypes: [...tsFnTypes, externalType{name:'npm/...', importSource:undefined}]
  - importedNpmNodeTypes: [fwImportType{name:'npm/...', importSource:'acorn'}]  (from @fwImport)
  ──────────────────────────────────────────────────────────────────────────────
  BUG: workflowNodeTypes = [...availableNodeTypes, ...importedNpmNodeTypes]
       = [..., externalType, fwImportType]
       → 2 entries for same npm type!  (parser.ts:1130)
  ──────────────────────────────────────────────────────────────────────────────

Mutator: addNode() only adds instance, nodeTypes unchanged → still 2 entries

Merge (mutateWorkflowFile:676-682):
  - parsedTypesWithImportSource = {'npm/acorn/parseExpressionAt': 'acorn'}
  - externalType has no importSource → gets importSource from map
  - fwImportType already has importSource → unchanged
  → Both entries now have importSource!

generateWorkflowJSDoc: 2 types with importSource → writes 2 @fwImport

File state: 2 @fwImport ✗
```

### Write 3: any subsequent mutation
```
File state: 2 @fwImport
Parser input:
  - availableNodeTypes: [...tsFnTypes, externalType{importSource:undefined}]
  - importedNpmNodeTypes: [fwImport1{importSource:'acorn'}, fwImport2{importSource:'acorn'}]
  ──────────────────────────────────────────────────────────────────────────────
  BUG: workflowNodeTypes = [...availableNodeTypes, ...importedNpmNodeTypes]
       = [..., externalType, fwImport1, fwImport2]
       → 3 entries for same npm type!
  ──────────────────────────────────────────────────────────────────────────────

Merge: externalType gets importSource → all 3 have importSource
generateWorkflowJSDoc: 3 types with importSource → writes 3 @fwImport

File state: 3 @fwImport ✗  (grows unboundedly with each write)
```

## Root Cause

**`parser.ts:1130`** — No deduplication between `availableNodeTypes` (containing the external/runtime type) and `importedNpmNodeTypes` (from `@fwImport` annotations):

```typescript
const workflowNodeTypes = [...availableNodeTypes, ...importedNpmNodeTypes];
```

The external type (from `externalNodeTypes` injected by the client's `wrappedServiceLayer`) has the same `name` as the `@fwImport` type, but different `functionName` and no `importSource`. Both are included, creating duplicates.

Then `mutateWorkflowFile`'s merge logic (lines 676-682) copies `importSource` onto the external copy, so ALL copies end up with `importSource`, and `generateWorkflowJSDoc` writes one `@fwImport` line per copy.

## Fix Location

**`parser.ts:1130`** — When merging, prefer `importedNpmNodeTypes` over duplicates in `availableNodeTypes`:

```typescript
// Deduplicate: @fwImport types take precedence over external types with same name
const importedNames = new Set(importedNpmNodeTypes.map(nt => nt.name));
const dedupedAvailableTypes = availableNodeTypes.filter(nt => !importedNames.has(nt.name));
const workflowNodeTypes = [...dedupedAvailableTypes, ...importedNpmNodeTypes];
```

## Test Proof

```
Write 1: 1 @fwImport ✓ (correct)
Write 2: 2 @fwImport ✗ (expected 1)
Write 3: 3 @fwImport ✗ (expected 1, grows unboundedly)
```
