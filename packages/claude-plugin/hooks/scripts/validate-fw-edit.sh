#!/bin/bash

# Flow Weaver edit validation hook
# Allows direct editing of workflow source files (code-first approach)
# Blocks editing of generated .generated.* files

# Read the tool use from stdin (JSON format)
TOOL_USE=$(cat)

# Extract tool name and parameters
TOOL_NAME=$(echo "$TOOL_USE" | jq -r '.tool_name // empty')
FILE_PATH=$(echo "$TOOL_USE" | jq -r '.parameters.file_path // empty')

# Check if this is an Edit or Write operation on a generated file
if [[ "$TOOL_NAME" == "Edit" || "$TOOL_NAME" == "Write" ]]; then
  if [[ "$FILE_PATH" =~ \.generated\.(ts|js)$ ]]; then
    # Block the operation on generated files only
    cat <<EOF
{
  "allowed": false,
  "message": "Cannot directly edit Flow Weaver generated files (*.generated.ts/js).\nThese files are auto-generated from source files.\n\nTo modify the workflow, edit the corresponding source file instead."
}
EOF
    exit 0
  fi
fi

# Allow all other operations (including source file edits)
echo '{"allowed": true}'
