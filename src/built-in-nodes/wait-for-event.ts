import { getMockConfig, lookupMock } from './mock-types.js';

/**
 * @flowWeaver nodeType
 * @input eventName - Event name to wait for (e.g. "app/approval.received")
 * @input [match] - Field to match between trigger and waited event (e.g. "data.requestId")
 * @input [timeout] - Max wait time (e.g. "24h", "7d"). Empty = no timeout
 * @output eventData - The received event's data payload
 */
export async function waitForEvent(
  execute: boolean,
  eventName: string,
  match?: string,
  timeout?: string
): Promise<{ onSuccess: boolean; onFailure: boolean; eventData: object }> {
  if (!execute) return { onSuccess: false, onFailure: false, eventData: {} };

  const mocks = getMockConfig();
  if (mocks) {
    // Mock mode — look up event data by name (supports instance-qualified keys)
    const mockData = lookupMock(mocks.events, eventName);
    if (mockData !== undefined) {
      return { onSuccess: true, onFailure: false, eventData: mockData };
    }
    // No mock data for this event — simulate timeout
    return { onSuccess: false, onFailure: true, eventData: {} };
  }

  // No mocks: original no-op behavior (always succeeds)
  return { onSuccess: true, onFailure: false, eventData: {} };
}
