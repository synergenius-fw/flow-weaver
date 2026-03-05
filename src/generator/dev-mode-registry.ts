/**
 * Extension point for custom dev mode providers.
 *
 * Extensions register dev mode handlers here so the dev command can
 * start target-specific dev servers without hardcoding any pack logic.
 */

export interface DevModeOptions {
  workflow?: string;
  framework?: string;
  port?: number;
  production?: boolean;
  once?: boolean;
  json?: boolean;
}

export interface DevModeProvider {
  name: string;
  run(filePath: string, options: DevModeOptions): Promise<void>;
}

class DevModeRegistry {
  private providers = new Map<string, DevModeProvider>();

  register(provider: DevModeProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): DevModeProvider | undefined {
    return this.providers.get(name);
  }

  getNames(): string[] {
    return [...this.providers.keys()];
  }
}

export const devModeRegistry = new DevModeRegistry();
