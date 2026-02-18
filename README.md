# @synergenius/flow-weaver

[![License: ELv2-based](https://img.shields.io/badge/License-ELv2--based-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)

TypeScript annotation-based workflow compiler for Flow Weaver.

Build visual workflows using JSDoc annotations and TypeScript function signatures. Full type safety, IDE autocomplete, and instant validation.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [API](#api)
- [Exports](#exports)
- [CLI Reference](#cli-reference)
- [STEP Port Architecture](#step-port-architecture)
- [Annotations](#annotations)
- [Deployment](#deployment)
- [MCP Integration](#mcp-integration)
- [API Documentation](#api-documentation)
- [Testing](#testing)
- [Development](#development)
- [License](#license)

## Installation

```bash
npm install @synergenius/flow-weaver
```

## Quick Start

Create a workflow file (any `.ts`, `.tsx`, `.js`, or `.jsx` file works):

```typescript
// math-workflow.ts

/**
 * @flowWeaver nodeType
 * @input x
 * @input y
 * @output result
 */
function multiply(execute: boolean, x: number, y: number) {
  if (!execute) return { onSuccess: false, onFailure: false, result: 0 };
  return { onSuccess: true, onFailure: false, result: x * y };
}

/**
 * @flowWeaver workflow
 * @node multiplier multiply
 * @connect Start.x -> multiplier.x
 * @connect Start.y -> multiplier.y
 * @connect multiplier.result -> Exit.result
 */
export async function multiplyWorkflow(
  execute: boolean,
  params: { x: number; y: number }
): Promise<{ onSuccess: boolean; onFailure: boolean; result: number }> {
  throw new Error('Not implemented');
}
```

Compile:

```bash
npx flow-weaver compile math-workflow.ts
```

## API

```typescript
import {
  parseWorkflow,      // Parse workflow file to AST
  compileWorkflow,    // Parse + generate in one step
  validateWorkflow,   // Validate AST
  generateCode,       // Generate code from AST
} from '@synergenius/flow-weaver';

// Parse and compile
const { code } = await compileWorkflow('workflow.ts');

// Or step by step
const { ast } = await parseWorkflow('workflow.ts');
const code = generateCode(ast);
```

Additional APIs: `compileWorkflows()`, `compilePattern()`, `generateInPlace()`. See [API documentation](#api-documentation) for details.

## Exports

| Import Path | Purpose |
|-------------|---------|
| `@synergenius/flow-weaver` | Main — parse, validate, compile, generate, AST types, builders, diff, JSDoc sync |
| `@synergenius/flow-weaver/runtime` | Execution context & errors for generated code |
| `@synergenius/flow-weaver/built-in-nodes` | Built-in workflow nodes (delay, waitForEvent, invokeWorkflow) |
| `@synergenius/flow-weaver/diagram` | Workflow diagram layout and rendering |
| `@synergenius/flow-weaver/describe` | Programmatic workflow description (structure, nodes, paths) |

## CLI Reference

### Core Commands

```bash
flow-weaver compile <file>              # Compile workflow files
  --production                          # Production mode (no debug events)
  --watch                               # Recompile on changes
  --dry-run                             # Preview without writing
  --optimize                            # Optimize workflow compilation
  --strict                              # Strict validation mode
  --source-map                          # Generate source maps
  --format esm|cjs|auto                 # Output module format

flow-weaver validate <file>             # Validate without compiling
  --verbose | --quiet | --json          # Output format
  --strict                              # Strict type checking

flow-weaver run <file>                  # Execute a workflow
  --params '{"key":"val"}'              # Input parameters (JSON)
  --params-file params.json             # Parameters from file
  --production                          # Production mode
  --trace                               # Include execution trace
  --timeout 30000                       # Execution timeout (ms)

flow-weaver dev <file>                  # Watch + compile + run
  --params '{"key":"val"}'              # Input parameters
  --once                                # Run once then exit

flow-weaver watch <file>                # Watch and recompile
flow-weaver describe <file>             # Output structure
  --format json|text|mermaid|paths      # Output format
  --node <id>                           # Focus on specific node
flow-weaver diagram <file>              # Generate SVG diagram
  --theme dark|light                    # Color theme (default: dark)
  --width <pixels>                      # SVG width
  --no-port-labels                      # Hide port data type labels
  -o, --output <file>                   # Write to file (default: stdout)
flow-weaver diff <f1> <f2>              # Semantic comparison
  --format text|json|compact            # Output format
```

### Project Setup

```bash
flow-weaver init [directory]            # Create new project
  --template <name>                     # Project template
  --yes                                 # Accept defaults
flow-weaver create workflow <tmpl> <f>  # Scaffold workflow from template
flow-weaver create node <name> <file>   # Scaffold node type
flow-weaver templates                   # List available templates
flow-weaver doctor                      # Check project compatibility
flow-weaver grammar                     # Output annotation grammar (EBNF/railroad)
```

### Deployment

```bash
flow-weaver serve [directory]           # HTTP server for workflows
  --port 3000                           # Server port
  --swagger                             # Enable Swagger UI at /docs
  --production                          # Production mode
flow-weaver export <file>               # Serverless export
  --target lambda|vercel|cloudflare     # Deployment target
  --multi                               # Multi-workflow service
  --docs                                # Include OpenAPI routes
flow-weaver openapi <directory>         # Generate OpenAPI spec
  --format json|yaml                    # Output format
```

### Patterns and Migration

```bash
flow-weaver pattern list <path>         # List patterns in file
flow-weaver pattern apply <pat> <tgt>   # Apply pattern to workflow
flow-weaver pattern extract <source>    # Extract pattern from nodes
flow-weaver migrate <glob>              # Migrate to current syntax
  --dry-run                             # Preview changes
  --diff                                # Show changes
flow-weaver changelog                   # Generate changelog from git
```

### IDE Integration

```bash
flow-weaver mcp-server                  # Start MCP server for Claude Code
flow-weaver listen                      # Stream editor events (JSON lines)
flow-weaver plugin init <name>          # Scaffold external plugin
flow-weaver ui focus-node <id>          # Focus node in editor
flow-weaver ui add-node <type>          # Add node to editor
flow-weaver ui open-workflow <path>     # Open workflow file
flow-weaver ui get-state                # Get editor state
flow-weaver ui batch <json>             # Batch editor commands
```

## STEP Port Architecture

All nodes follow this pattern:

```typescript
function nodeName(
  execute: boolean,    // Control input
  ...inputs            // Data inputs
): {
  onSuccess: boolean;  // Success control output
  onFailure: boolean;  // Failure control output
  ...outputs           // Data outputs
}
```

Expression nodes (`@expression`) skip the control flow boilerplate — inputs and outputs are inferred from the TypeScript signature.

## Annotations

### @flowWeaver nodeType

```typescript
/**
 * @flowWeaver nodeType
 * @input value
 * @output result
 * @label Double
 * @pullExecution execute
 */
```

### @flowWeaver workflow

```typescript
/**
 * @flowWeaver workflow
 * @node instance1 nodeType
 * @connect Start.input -> instance1.value
 * @connect instance1.result -> Exit.output
 * @path Start -> n1 -> n2 -> Exit
 * @path n1:fail -> errorHandler -> Exit
 */
```

## Deployment

### HTTP Server

```bash
flow-weaver serve ./workflows --swagger --port 3000
```

Serves all workflows as HTTP endpoints with optional Swagger UI at `/docs`.

### Serverless Export

```bash
# AWS Lambda (generates SAM template + handler)
flow-weaver export workflow.ts --target lambda --output deploy/

# Vercel (generates api/ handler + vercel.json)
flow-weaver export workflow.ts --target vercel --output deploy/

# Cloudflare Workers (generates worker + wrangler.toml)
flow-weaver export workflow.ts --target cloudflare --output deploy/

# Multi-workflow service with OpenAPI docs
flow-weaver export workflow.ts --target vercel --multi --docs --output deploy/
```

## MCP Integration

Start the MCP server for use with Claude Code:

```bash
npx flow-weaver mcp-server
```

30+ tools across five categories:
- **Editor** (13): check events, get state, focus/add/remove nodes, connect, batch, execute, undo/redo
- **Query** (6): describe, validate, compile, diff, query (10 query types), doctor
- **Template** (2): list templates, scaffold
- **Pattern** (7): list/apply/extract patterns, find workflows, modify, modify batch, migrate
- **Export** (1): export to serverless targets

## API Documentation

Generate TypeDoc API reference:

```bash
npm run docs
```

Output is in `docs/api/`. Covers all public APIs with parameters, return types, and examples.

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

## Development

```bash
npm run build         # Build
npm run dev           # Watch mode
npm run typecheck     # Type check
npm run docs          # Generate API docs
```

## License

Custom license based on the Elastic License 2.0. See [LICENSE](./LICENSE) for full terms.

- **Free to use** — any individual or organization can install, run, and compile workflows
- **Free to host internally** for organizations with 15 or fewer people
- **Commercial license required** to host internally for organizations with more than 15 people — contact support@synergenius.pt
- **External hosting prohibited** — cannot be provided as a hosted/managed service to third parties without a commercial license
- **Output is unrestricted** — compiled workflows, generated code, and deployment artifacts are yours
