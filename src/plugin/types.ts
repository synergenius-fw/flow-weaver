/**
 * External plugin types — pure TypeScript interfaces (no zod).
 *
 * These mirror the zod schemas in src/plugin-system/externalTypes.ts
 * but are dependency-free so external plugin authors only need this package.
 */

import type { ReactNode } from 'react';

// ── Component types ────────────────────────────────────────────────────────

export type TPluginComponentArea = 'sidebar' | 'main' | 'toolbar' | 'modal' | 'panel';

export interface TPluginComponentConfig {
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  area: TPluginComponentArea;
}

export interface TPluginComponentApi {
  call: (pluginName: string, method: string, payload?: unknown) => Promise<unknown>;
}

export interface TPluginComponentProps {
  pluginName: string;
  componentName: string;
  config: TPluginComponentConfig;
  children?: ReactNode;
  api: TPluginComponentApi;
}

// ── Plugin UI ──────────────────────────────────────────────────────────────

export interface TPluginUI {
  components: Record<string, React.ComponentType<TPluginComponentProps>>;
  config: Record<string, TPluginComponentConfig>;
}

// ── Plugin initializer ─────────────────────────────────────────────────────

export interface TPluginInitializerResult {
  initialize?: () => Promise<void>;
  ui?: TPluginUI;
}

export type TPluginInitializer = () => TPluginInitializerResult;

// ── System module ──────────────────────────────────────────────────────────

export interface TPluginSystemModule {
  initialize?: () => Promise<void> | void;
  methods: Record<string, (...args: unknown[]) => unknown>;
  cleanup?: () => Promise<void> | void;
}

// ── Capabilities & definition ──────────────────────────────────────────────

export interface TPluginCapabilities {
  filesystem?: {
    allowed: boolean;
    paths?: string[];
    operations?: Array<'read' | 'write' | 'delete'>;
  };
  network?: {
    allowed: boolean;
    domains?: string[];
    protocols?: Array<'http' | 'https' | 'ws' | 'wss'>;
  };
  process?: {
    allowed: boolean;
    maxMemory?: number;
    timeout?: number;
  };
  interop?: {
    allowed: boolean;
    plugins?: string[];
  };
}

export interface TPluginDefinition {
  name: string;
  version: string;
  description: string;
  entry: {
    client: string;
    system?: string;
  };
  dependencies?: {
    plugins?: string[];
    system?: string[];
  };
  capabilities: TPluginCapabilities;
}
