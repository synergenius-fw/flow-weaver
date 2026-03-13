/**
 * Coverage tests for WorkflowRegistry file watcher (lines 191-205, 218).
 * Covers the debounced 'all' event handler and stopWatching timer cleanup.
 */

import { WorkflowRegistry } from '../../src/server/workflow-registry';

// Mock chokidar with controllable event emitter
const mockWatcher = {
  on: vi.fn().mockReturnThis(),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('chokidar', () => ({
  watch: vi.fn(() => mockWatcher),
}));

// Mock glob to return nothing (no workflows to discover)
vi.mock('glob', () => ({
  glob: vi.fn().mockResolvedValue([]),
}));

describe('WorkflowRegistry file watcher', () => {
  let registry: WorkflowRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWatcher.on.mockClear();
    mockWatcher.close.mockClear();
    registry = new WorkflowRegistry('/tmp/workflows');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('triggers debounced rediscovery on .ts file change', async () => {
    const onChange = vi.fn();
    await registry.startWatching(onChange);

    // Get the 'all' event callback
    const allHandler = mockWatcher.on.mock.calls.find(
      (call: any[]) => call[0] === 'all'
    )?.[1] as Function;
    expect(allHandler).toBeDefined();

    // Trigger a .ts file change
    allHandler('change', '/tmp/workflows/test.ts');

    // onChange should not fire yet (debounced by 500ms)
    expect(onChange).not.toHaveBeenCalled();

    // Advance past the debounce timer
    await vi.advanceTimersByTimeAsync(600);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores non-.ts file changes', async () => {
    const onChange = vi.fn();
    await registry.startWatching(onChange);

    const allHandler = mockWatcher.on.mock.calls.find(
      (call: any[]) => call[0] === 'all'
    )?.[1] as Function;

    // Trigger a non-.ts file change
    allHandler('change', '/tmp/workflows/readme.md');

    await vi.advanceTimersByTimeAsync(600);

    // onChange should not be called for non-.ts files
    expect(onChange).not.toHaveBeenCalled();
  });

  it('debounces rapid changes to the same file', async () => {
    const onChange = vi.fn();
    await registry.startWatching(onChange);

    const allHandler = mockWatcher.on.mock.calls.find(
      (call: any[]) => call[0] === 'all'
    )?.[1] as Function;

    // Rapidly trigger changes to the same file
    allHandler('change', '/tmp/workflows/test.ts');
    await vi.advanceTimersByTimeAsync(200);
    allHandler('change', '/tmp/workflows/test.ts');
    await vi.advanceTimersByTimeAsync(200);
    allHandler('change', '/tmp/workflows/test.ts');

    // Advance past the final debounce
    await vi.advanceTimersByTimeAsync(600);

    // Should only fire once despite multiple rapid changes
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('stopWatching clears pending debounce timers', async () => {
    const onChange = vi.fn();
    await registry.startWatching(onChange);

    const allHandler = mockWatcher.on.mock.calls.find(
      (call: any[]) => call[0] === 'all'
    )?.[1] as Function;

    // Trigger a change to create a pending timer
    allHandler('change', '/tmp/workflows/test.ts');

    // Stop watching before debounce fires
    await registry.stopWatching();

    // Advance time past the debounce
    await vi.advanceTimersByTimeAsync(600);

    // onChange should NOT have been called (timer was cleared)
    expect(onChange).not.toHaveBeenCalled();

    // Watcher should have been closed
    expect(mockWatcher.close).toHaveBeenCalled();
  });
});
