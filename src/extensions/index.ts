/**
 * Extension bootstrap loader.
 *
 * Side-effect imports for built-in extensions. Each extension self-registers
 * through the existing registry infrastructure (tag handlers, validation rules,
 * doc topics, templates, init use cases).
 *
 * CLI and MCP entry points import this file once at startup.
 */

import './cicd/register.js';
import './inngest/register.js';
