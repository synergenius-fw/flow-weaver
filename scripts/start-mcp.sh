#!/bin/bash
# Resolve project dir: CLAUDE_PROJECT_DIR (set by Claude Code sessions),
# or fall back to git root (for health checks / standalone use)
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
if [ -z "$PROJECT_DIR" ]; then
  echo "Error: CLAUDE_PROJECT_DIR not set and not inside a git repository" >&2
  exit 1
fi
export FW_EVENTS_FILE="${FW_EVENTS_FILE:-${TMPDIR:-/tmp}/fw-mcp-events.jsonl}"
exec npx flow-weaver mcp-server --stdio
