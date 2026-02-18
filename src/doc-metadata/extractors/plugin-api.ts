/**
 * Description layer for external plugin API schemas.
 *
 * These arrays provide human-readable descriptions for fields that are
 * extracted dynamically from Zod schemas at documentation build time.
 * Field names come from the live schemas (code-tied), descriptions from here.
 */

import type { TPluginApiFieldDoc } from '../types.js';

/** Field descriptions for pluginDefinitionSchema (plugin-artifact.yaml) */
export const PLUGIN_DEFINITION_FIELDS: TPluginApiFieldDoc[] = [
  {
    name: 'name',
    type: 'string',
    required: true,
    description: 'Unique plugin identifier (e.g., "my-analytics-plugin")',
  },
  {
    name: 'version',
    type: 'string',
    required: true,
    description: 'Semantic version (e.g., "1.0.0")',
  },
  {
    name: 'description',
    type: 'string',
    required: true,
    description: 'Human-readable plugin description',
  },
  {
    name: 'entry',
    type: 'object',
    required: true,
    description: 'Entry point paths for client and system modules',
    children: [
      {
        name: 'client',
        type: 'string',
        required: true,
        description: 'Client-side entry (e.g., "src/client.tsx")',
      },
      {
        name: 'system',
        type: 'string',
        required: false,
        description: 'Server-side entry (e.g., "src/system.ts")',
      },
    ],
  },
  {
    name: 'dependencies',
    type: 'object',
    required: false,
    description: 'Plugin and system dependencies',
    children: [
      {
        name: 'plugins',
        type: 'string[]',
        required: false,
        description: 'Required plugin IDs',
      },
      {
        name: 'system',
        type: 'string[]',
        required: false,
        description: 'Required system modules',
      },
    ],
  },
  {
    name: 'capabilities',
    type: 'object',
    required: true,
    description: 'Security capability declarations (see Capabilities section)',
  },
];

/** Field descriptions for pluginCapabilitiesSchema */
export const PLUGIN_CAPABILITIES: TPluginApiFieldDoc[] = [
  {
    name: 'filesystem',
    type: 'object',
    required: false,
    description: 'File system access',
    children: [
      {
        name: 'allowed',
        type: 'boolean',
        required: true,
        description: 'Enable filesystem access',
      },
      {
        name: 'paths',
        type: 'string[]',
        required: false,
        description: 'Allowed path patterns',
      },
      {
        name: 'operations',
        type: 'enum[]',
        required: false,
        description: 'Allowed operations',
        enum: ['read', 'write', 'delete'],
      },
    ],
  },
  {
    name: 'network',
    type: 'object',
    required: false,
    description: 'Network access',
    children: [
      {
        name: 'allowed',
        type: 'boolean',
        required: true,
        description: 'Enable network access',
      },
      {
        name: 'domains',
        type: 'string[]',
        required: false,
        description: 'Allowed domains',
      },
      {
        name: 'protocols',
        type: 'enum[]',
        required: false,
        description: 'Allowed protocols',
        enum: ['http', 'https', 'ws', 'wss'],
      },
    ],
  },
  {
    name: 'process',
    type: 'object',
    required: false,
    description: 'Process control',
    children: [
      {
        name: 'allowed',
        type: 'boolean',
        required: true,
        description: 'Enable process access',
      },
      {
        name: 'maxMemory',
        type: 'number',
        required: false,
        description: 'Memory limit in bytes',
      },
      {
        name: 'timeout',
        type: 'number',
        required: false,
        description: 'Execution timeout in ms',
      },
    ],
  },
  {
    name: 'interop',
    type: 'object',
    required: false,
    description: 'Inter-plugin communication',
    children: [
      {
        name: 'allowed',
        type: 'boolean',
        required: true,
        description: 'Enable inter-plugin calls',
      },
      {
        name: 'plugins',
        type: 'string[]',
        required: false,
        description: 'Allowed plugin IDs',
      },
    ],
  },
];

/** Field descriptions for pluginComponentConfigSchema */
export const PLUGIN_COMPONENT_CONFIG_FIELDS: TPluginApiFieldDoc[] = [
  {
    name: 'name',
    type: 'string',
    required: true,
    description: 'Component identifier (unique within plugin)',
  },
  {
    name: 'displayName',
    type: 'string',
    required: true,
    description: 'Label shown in UI headers and tabs',
  },
  {
    name: 'description',
    type: 'string',
    required: false,
    description: 'Tooltip or summary text',
  },
  {
    name: 'icon',
    type: 'string',
    required: false,
    description: 'Icon name from the icon catalog (camelCase)',
  },
  {
    name: 'area',
    type: 'enum',
    required: true,
    description: 'Placement area for the component',
  },
];

/** Description map for pluginComponentAreaSchema enum values */
export const PLUGIN_COMPONENT_AREAS: Record<string, string> = {
  sidebar: 'Left dock zone (alongside project, documentation)',
  main: 'Center content area',
  toolbar: 'Rendered inline in toolbar — not window-compatible',
  modal: 'Overlay dialog — not window-compatible',
  panel: 'Right dock zone (alongside history, deployment)',
};

/** Categorized UI Kit components available to external plugins */
export const PLUGIN_UI_KIT_COMPONENTS: Record<string, string[]> = {
  Display: [
    'Chip',
    'WorkflowDiagram',
    'NodeDiagram',
    'CodeBlock',
    'CodeSnippet',
    'CountBadge',
    'EmptyState',
    'Header',
    'Icon',
    'InfoSection',
    'JsonViewer',
    'KeyValueRow',
    'PanelHeader',
    'PanelTitle',
    'PortTag',
    'ProfileBadge',
    'StatusCard',
    'StatusDot',
    'StatusIndicator',
    'Table',
    'Tag',
    'TruncateText',
    'Typography',
  ],
  Feedback: ['Banner', 'ErrorBoundary', 'LoadingContainer', 'LoadingSpinner', 'Tooltip'],
  Input: [
    'Button',
    'ButtonGroup',
    'IconButton',
    'Calendar',
    'Checkbox',
    'CodeEditor',
    'Input',
    'Slider',
    'StatusChip',
    'Switch',
    'ToggleGroup',
    'Tree',
    'ExpressionControl',
    'SelectableCard',
    'NodeIconPicker',
  ],
  Layout: [
    'CollapsibleSection',
    'Divider',
    'Draggable',
    'Flex',
    'Menu',
    'MenuItem',
    'Modal',

    'ResponsiveContainer',
    'Tabs',
    'Window',
  ],
  Navigation: ['Breadcrumbs', 'Stepper'],
  Hooks: ['useVerticalResize', 'useStableCallback', 'useDebouncedLoading'],
};
