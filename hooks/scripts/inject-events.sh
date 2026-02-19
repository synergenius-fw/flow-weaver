#!/bin/bash
# Drain editor events and inject into Claude's context
EVENTS_FILE="${FW_EVENTS_FILE:-${TMPDIR:-/tmp}/fw-mcp-events.jsonl}"
DRAIN_FILE="${EVENTS_FILE}.drain"
EVENT_CAP="${FW_EVENT_CAP:-100}"

# Atomically move file to prevent race condition with MCP server
mv "$EVENTS_FILE" "$DRAIN_FILE" 2>/dev/null || exit 0

if [ -s "$DRAIN_FILE" ]; then
  LINE_COUNT=$(wc -l < "$DRAIN_FILE" | tr -d ' ')
  if [ "$LINE_COUNT" -gt "$EVENT_CAP" ]; then
    SKIPPED=$((LINE_COUNT - EVENT_CAP))
    # Build a summary of skipped event types (counts by type)
    SUMMARY=$(head -n "$SKIPPED" "$DRAIN_FILE" \
      | grep -o '"event":"[^"]*"' \
      | sort | uniq -c | sort -rn \
      | while read -r cnt evt; do
          # Extract event name from "event":"name"
          name=$(echo "$evt" | sed 's/"event":"//;s/"//')
          printf '%s(%s) ' "$name" "$cnt"
        done)
    echo "[Flow Weaver: $LINE_COUNT editor events since last message, showing last $EVENT_CAP — skipped $SKIPPED: $SUMMARY]"
    tail -n "$EVENT_CAP" "$DRAIN_FILE"
  else
    echo "[Flow Weaver: $LINE_COUNT editor events since last message]"
    cat "$DRAIN_FILE"
  fi
  echo "[End Flow Weaver Events]"
  rm -f "$DRAIN_FILE"
fi

exit 0
