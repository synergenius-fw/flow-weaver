import * as fs from 'fs';
import type { BufferedEvent, EventFilterConfig } from './types.js';
import { DEFAULT_EVENT_FILTER } from './types.js';

/**
 * In-memory circular buffer for editor events with filtering, deduplication, and optional
 * file-based persistence. Events are filtered by include/exclude patterns and deduplicated
 * within a configurable time window.
 */
export class EventBuffer {
  private events: BufferedEvent[] = [];
  private maxSize: number;
  private eventsFilePath: string | null;
  private filter: EventFilterConfig;
  private lastEventByType: Map<string, number> = new Map();

  /**
   * @param maxSize - Maximum buffer capacity. Defaults to the filter's `maxBufferSize`.
   * @param eventsFilePath - Path to a file for appending events as NDJSON. Pass `null` to disable.
   *   Falls back to the `FW_EVENTS_FILE` environment variable if not specified.
   * @param filter - Partial filter config merged with {@link DEFAULT_EVENT_FILTER}.
   */
  constructor(
    maxSize?: number,
    eventsFilePath?: string | null,
    filter?: Partial<EventFilterConfig>
  ) {
    this.filter = { ...DEFAULT_EVENT_FILTER, ...filter };
    this.maxSize = maxSize ?? this.filter.maxBufferSize;
    // null = explicitly disabled, undefined = check env
    this.eventsFilePath =
      eventsFilePath === null ? null : (eventsFilePath ?? process.env.FW_EVENTS_FILE ?? null);
  }

  /**
   * Updates the event filter configuration. If `maxBufferSize` changes, trims the buffer to fit.
   * @param partial - Partial filter fields to merge into the current config.
   * @returns The full updated filter configuration.
   */
  setFilter(partial: Partial<EventFilterConfig>): EventFilterConfig {
    this.filter = { ...this.filter, ...partial };
    if (partial.maxBufferSize !== undefined) {
      this.maxSize = partial.maxBufferSize;
      if (this.events.length > this.maxSize) {
        this.events = this.events.slice(this.events.length - this.maxSize);
      }
    }
    return { ...this.filter };
  }

  /** Returns a copy of the current event filter configuration. */
  getFilter(): EventFilterConfig {
    return { ...this.filter };
  }

  /**
   * Pushes an event into the buffer. The event is dropped if it does not pass the
   * include/exclude filters. If deduplication is enabled and an identical event type
   * was pushed within the dedup window, the previous entry is replaced instead.
   * Evicts the oldest events when the buffer exceeds `maxSize`.
   * @param event - The event name.
   * @param data - The event payload.
   */
  push(event: string, data: unknown): void {
    if (!this.matchesFilter(event)) return;

    const entry: BufferedEvent = {
      event,
      data,
      timestamp: new Date().toISOString(),
    };

    // Dedup: if same event type within window, replace the last instance
    if (this.filter.dedupeWindowMs > 0) {
      const now = Date.now();
      const lastTime = this.lastEventByType.get(event);
      if (lastTime !== undefined && now - lastTime < this.filter.dedupeWindowMs) {
        // Replace the last event of this type in the buffer
        for (let i = this.events.length - 1; i >= 0; i--) {
          if (this.events[i].event === event) {
            this.events[i] = entry;
            this.lastEventByType.set(event, now);
            this.appendToFile(entry);
            return;
          }
        }
      }
      this.lastEventByType.set(event, now);
    }

    this.events.push(entry);
    // Evict oldest if over limit
    if (this.events.length > this.maxSize) {
      this.events = this.events.slice(this.events.length - this.maxSize);
    }
    this.appendToFile(entry);
  }

  private matchesFilter(event: string): boolean {
    const { include, exclude } = this.filter;

    // If include list is non-empty, event must match at least one pattern
    if (include.length > 0) {
      if (!include.some((pattern) => matchPattern(event, pattern))) {
        return false;
      }
    }

    // If event matches any exclude pattern, reject it
    if (exclude.length > 0) {
      if (exclude.some((pattern) => matchPattern(event, pattern))) {
        return false;
      }
    }

    return true;
  }

  private appendToFile(entry: BufferedEvent): void {
    if (!this.eventsFilePath) return;
    try {
      fs.appendFileSync(this.eventsFilePath, JSON.stringify(entry) + '\n');
    } catch {
      // File may have been atomically moved by the hook — next push creates a new one
    }
  }

  /**
   * Returns all buffered events and clears the buffer.
   * @returns A copy of all events that were in the buffer.
   */
  drain(): BufferedEvent[] {
    const result = [...this.events];
    this.events = [];
    return result;
  }

  /**
   * Returns a copy of all buffered events without clearing the buffer.
   * @returns A copy of the current events.
   */
  peek(): BufferedEvent[] {
    return [...this.events];
  }

  /** Clears all events from the buffer. */
  clear(): void {
    this.events = [];
  }

  /** The number of events currently in the buffer. */
  get length(): number {
    return this.events.length;
  }
}

/**
 * Tests whether an event name matches a filter pattern.
 * Supports exact matching and prefix matching when the pattern ends with `*`.
 * @param event - The event name to test.
 * @param pattern - The pattern to match against. Trailing `*` enables prefix matching.
 * @returns `true` if the event matches the pattern.
 */
export function matchPattern(event: string, pattern: string): boolean {
  if (pattern.endsWith('*')) {
    return event.startsWith(pattern.slice(0, -1));
  }
  return event === pattern;
}
