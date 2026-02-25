import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { EventBuffer, matchPattern } from '../../../src/mcp/event-buffer';

vi.mock('fs');

const mockedFs = vi.mocked(fs);

describe('matchPattern', () => {
  it('matches exact event names', () => {
    expect(matchPattern('fw:node-added', 'fw:node-added')).toBe(true);
  });

  it('rejects non-matching exact names', () => {
    expect(matchPattern('fw:node-added', 'fw:node-removed')).toBe(false);
  });

  it('matches prefix patterns ending with *', () => {
    expect(matchPattern('fw:node-added', 'fw:*')).toBe(true);
    expect(matchPattern('fw:node-removed', 'fw:*')).toBe(true);
  });

  it('rejects events that do not match prefix', () => {
    expect(matchPattern('integration:command', 'fw:*')).toBe(false);
  });

  it('handles empty event name', () => {
    expect(matchPattern('', '')).toBe(true);
    expect(matchPattern('', 'fw:*')).toBe(false);
  });

  it('handles wildcard-only pattern', () => {
    // '*' means prefix '' which matches everything
    expect(matchPattern('anything', '*')).toBe(true);
    expect(matchPattern('', '*')).toBe(true);
  });
});

describe('EventBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    delete process.env.FW_EVENTS_FILE;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('uses default filter values when no args provided', () => {
      const buf = new EventBuffer();
      const filter = buf.getFilter();
      expect(filter.include).toEqual([]);
      expect(filter.exclude).toEqual(['fw:ack']);
      expect(filter.dedupeWindowMs).toBe(200);
      expect(filter.maxBufferSize).toBe(500);
    });

    it('uses maxSize from filter.maxBufferSize when not explicitly provided', () => {
      const buf = new EventBuffer(undefined, null, { maxBufferSize: 10 });
      // Fill past 10 and check eviction
      for (let i = 0; i < 15; i++) {
        buf.push(`event-${i}`, { i });
      }
      expect(buf.length).toBe(10);
    });

    it('uses explicit maxSize over filter maxBufferSize', () => {
      const buf = new EventBuffer(3, null, { maxBufferSize: 100 });
      for (let i = 0; i < 10; i++) {
        buf.push(`event-${i}`, { i });
      }
      expect(buf.length).toBe(3);
    });

    it('reads FW_EVENTS_FILE env var when eventsFilePath is undefined', () => {
      process.env.FW_EVENTS_FILE = '/tmp/events.ndjson';
      const buf = new EventBuffer(10);
      buf.push('test', { data: 1 });
      expect(mockedFs.appendFileSync).toHaveBeenCalledWith(
        '/tmp/events.ndjson',
        expect.any(String)
      );
    });

    it('disables file persistence when eventsFilePath is null', () => {
      process.env.FW_EVENTS_FILE = '/tmp/events.ndjson';
      const buf = new EventBuffer(10, null);
      buf.push('test', { data: 1 });
      expect(mockedFs.appendFileSync).not.toHaveBeenCalled();
    });

    it('uses explicit eventsFilePath over env var', () => {
      process.env.FW_EVENTS_FILE = '/tmp/env-file.ndjson';
      const buf = new EventBuffer(10, '/tmp/explicit.ndjson');
      buf.push('test', { data: 1 });
      expect(mockedFs.appendFileSync).toHaveBeenCalledWith(
        '/tmp/explicit.ndjson',
        expect.any(String)
      );
    });
  });

  describe('push', () => {
    it('adds events to the buffer', () => {
      const buf = new EventBuffer(100, null, { dedupeWindowMs: 0, include: [], exclude: [] });
      buf.push('test:event', { value: 42 });
      expect(buf.length).toBe(1);
      const events = buf.peek();
      expect(events[0].event).toBe('test:event');
      expect(events[0].data).toEqual({ value: 42 });
      expect(events[0].timestamp).toBeDefined();
    });

    it('filters out events matching exclude patterns', () => {
      const buf = new EventBuffer(100, null, { exclude: ['fw:ack'], dedupeWindowMs: 0 });
      buf.push('fw:ack', { id: '123' });
      expect(buf.length).toBe(0);
    });

    it('filters out events not matching include patterns', () => {
      const buf = new EventBuffer(100, null, {
        include: ['fw:*'],
        exclude: [],
        dedupeWindowMs: 0,
      });
      buf.push('integration:command', {});
      expect(buf.length).toBe(0);
      buf.push('fw:node-added', {});
      expect(buf.length).toBe(1);
    });

    it('exclude takes precedence when both match', () => {
      const buf = new EventBuffer(100, null, {
        include: ['fw:*'],
        exclude: ['fw:ack'],
        dedupeWindowMs: 0,
      });
      buf.push('fw:ack', {});
      expect(buf.length).toBe(0);
      buf.push('fw:node-added', {});
      expect(buf.length).toBe(1);
    });

    it('evicts oldest events when buffer exceeds maxSize', () => {
      const buf = new EventBuffer(3, null, { dedupeWindowMs: 0, exclude: [] });
      buf.push('a', 1);
      buf.push('b', 2);
      buf.push('c', 3);
      buf.push('d', 4);
      expect(buf.length).toBe(3);
      const events = buf.peek();
      expect(events.map((e) => e.event)).toEqual(['b', 'c', 'd']);
    });

    it('deduplicates events within the dedup window', () => {
      const buf = new EventBuffer(100, null, { dedupeWindowMs: 500, exclude: [] });

      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
      buf.push('cursor:move', { x: 1 });
      expect(buf.length).toBe(1);

      // Push same event type within window: should replace
      vi.setSystemTime(new Date('2024-01-01T00:00:00.200Z'));
      buf.push('cursor:move', { x: 2 });
      expect(buf.length).toBe(1);

      const events = buf.peek();
      expect(events[0].data).toEqual({ x: 2 });
    });

    it('does not dedup events outside the dedup window', () => {
      const buf = new EventBuffer(100, null, { dedupeWindowMs: 500, exclude: [] });

      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
      buf.push('cursor:move', { x: 1 });

      // Push same event type OUTSIDE window: should add new
      vi.setSystemTime(new Date('2024-01-01T00:00:01.000Z'));
      buf.push('cursor:move', { x: 2 });
      expect(buf.length).toBe(2);
    });

    it('does not dedup different event types', () => {
      const buf = new EventBuffer(100, null, { dedupeWindowMs: 500, exclude: [] });

      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
      buf.push('cursor:move', { x: 1 });

      vi.setSystemTime(new Date('2024-01-01T00:00:00.100Z'));
      buf.push('cursor:click', { x: 1 });
      expect(buf.length).toBe(2);
    });

    it('dedup disabled when dedupeWindowMs is 0', () => {
      const buf = new EventBuffer(100, null, { dedupeWindowMs: 0, exclude: [] });
      buf.push('same', { v: 1 });
      buf.push('same', { v: 2 });
      expect(buf.length).toBe(2);
    });

    it('appends to file on each push', () => {
      const buf = new EventBuffer(100, '/tmp/test.ndjson', { dedupeWindowMs: 0, exclude: [] });
      buf.push('test', { data: 1 });
      expect(mockedFs.appendFileSync).toHaveBeenCalledTimes(1);
      const written = mockedFs.appendFileSync.mock.calls[0][1] as string;
      expect(written).toMatch(/"event":"test"/);
      expect(written.endsWith('\n')).toBe(true);
    });

    it('silently ignores file write errors', () => {
      mockedFs.appendFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const buf = new EventBuffer(100, '/tmp/missing.ndjson', { dedupeWindowMs: 0, exclude: [] });
      // Should not throw
      expect(() => buf.push('test', {})).not.toThrow();
      expect(buf.length).toBe(1);
    });
  });

  describe('drain', () => {
    it('returns all events and clears the buffer', () => {
      const buf = new EventBuffer(100, null, { dedupeWindowMs: 0, exclude: [] });
      buf.push('a', 1);
      buf.push('b', 2);

      const drained = buf.drain();
      expect(drained).toHaveLength(2);
      expect(drained[0].event).toBe('a');
      expect(drained[1].event).toBe('b');
      expect(buf.length).toBe(0);
    });

    it('returns empty array when buffer is empty', () => {
      const buf = new EventBuffer(100, null);
      expect(buf.drain()).toEqual([]);
    });
  });

  describe('peek', () => {
    it('returns events without clearing the buffer', () => {
      const buf = new EventBuffer(100, null, { dedupeWindowMs: 0, exclude: [] });
      buf.push('a', 1);

      const peeked = buf.peek();
      expect(peeked).toHaveLength(1);
      expect(buf.length).toBe(1); // still there
    });

    it('returns a copy, not a reference', () => {
      const buf = new EventBuffer(100, null, { dedupeWindowMs: 0, exclude: [] });
      buf.push('a', 1);

      const peeked = buf.peek();
      peeked.push({ event: 'fake', data: null, timestamp: '' });
      expect(buf.length).toBe(1); // original unchanged
    });
  });

  describe('clear', () => {
    it('removes all events', () => {
      const buf = new EventBuffer(100, null, { dedupeWindowMs: 0, exclude: [] });
      buf.push('a', 1);
      buf.push('b', 2);
      buf.clear();
      expect(buf.length).toBe(0);
      expect(buf.peek()).toEqual([]);
    });
  });

  describe('setFilter', () => {
    it('updates the filter configuration', () => {
      const buf = new EventBuffer(100, null);
      const updated = buf.setFilter({ include: ['fw:*'] });
      expect(updated.include).toEqual(['fw:*']);
      // Other fields unchanged
      expect(updated.exclude).toEqual(['fw:ack']);
    });

    it('trims buffer when maxBufferSize is reduced', () => {
      const buf = new EventBuffer(100, null, { dedupeWindowMs: 0, exclude: [] });
      for (let i = 0; i < 10; i++) {
        buf.push(`e-${i}`, i);
      }
      expect(buf.length).toBe(10);

      buf.setFilter({ maxBufferSize: 3 });
      expect(buf.length).toBe(3);
      // Should keep the most recent
      const events = buf.peek();
      expect(events[0].event).toBe('e-7');
      expect(events[2].event).toBe('e-9');
    });

    it('does not trim when maxBufferSize is unchanged', () => {
      const buf = new EventBuffer(100, null, { dedupeWindowMs: 0, exclude: [] });
      buf.push('a', 1);
      buf.push('b', 2);
      buf.setFilter({ include: ['*'] });
      expect(buf.length).toBe(2);
    });

    it('returns the updated filter state', () => {
      const buf = new EventBuffer(100, null);
      const filter = buf.setFilter({ include: ['fw:*'] });
      expect(filter.include).toEqual(['fw:*']);
      expect(filter.exclude).toEqual(['fw:ack']);
      expect(filter.dedupeWindowMs).toBe(200);
    });
  });

  describe('getFilter', () => {
    it('returns the current filter configuration', () => {
      const buf = new EventBuffer(100, null, { include: ['fw:*'], exclude: ['fw:ack'] });
      const filter = buf.getFilter();
      expect(filter.include).toEqual(['fw:*']);
      expect(filter.exclude).toEqual(['fw:ack']);
    });

    it('reflects changes made via setFilter', () => {
      const buf = new EventBuffer(100, null);
      buf.setFilter({ include: ['test:*'] });
      const filter = buf.getFilter();
      expect(filter.include).toEqual(['test:*']);
    });
  });

  describe('length', () => {
    it('reflects the current number of events', () => {
      const buf = new EventBuffer(100, null, { dedupeWindowMs: 0, exclude: [] });
      expect(buf.length).toBe(0);
      buf.push('a', 1);
      expect(buf.length).toBe(1);
      buf.push('b', 2);
      expect(buf.length).toBe(2);
      buf.drain();
      expect(buf.length).toBe(0);
    });
  });
});
