/**
 * PluginPanel — standalone component for external plugins.
 *
 * At runtime, `evaluateClientCode()` in pluginClientManager intercepts
 * `require('@synergenius/flow-weaver/plugin')` and provides the real
 * component from src/plugin-system/external/components.tsx. This file
 * exists for TypeScript compile-time resolution only.
 */

import React from 'react';
import type { TPluginComponentProps } from './types.js';

export const PluginPanel: React.FC<TPluginComponentProps> = ({ children }) => {
  return <div className="plugin-panel">{children}</div>;
};
