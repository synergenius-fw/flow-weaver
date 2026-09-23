import {
  buildGateResolution,
  InvalidAnswerError,
  MissingOutputsError,
} from '../../../src/coordinator/gate-resolution.js';

const gateId = 'f'.repeat(64);
const single = { outputs: ['agentResult'], hasSuccessPort: true, hasFailurePort: true };
const multi = { outputs: ['summary', 'risk'], hasSuccessPort: true, hasFailurePort: true };
const none = { outputs: [], hasSuccessPort: true, hasFailurePort: false };

describe('buildGateResolution', () => {
  it('fills control ports and the single data port from a bare answer', () => {
    expect(buildGateResolution(single, gateId, { answer: { ok: true } })).toEqual({
      gateId,
      value: { onSuccess: true, onFailure: false, agentResult: { ok: true } },
    });
  });

  it('picks every declared output from a multi-output answer and drops extras', () => {
    const resolution = buildGateResolution(multi, gateId, {
      answer: { summary: 's', risk: 'low', extra: 1 },
    });
    expect(resolution.value).toEqual({ onSuccess: true, onFailure: false, summary: 's', risk: 'low' });
  });

  it('names the missing outputs of an incomplete multi-output answer', () => {
    expect(() => buildGateResolution(multi, gateId, { answer: { summary: 's' } })).toThrow(
      MissingOutputsError,
    );
    try {
      buildGateResolution(multi, gateId, { answer: { summary: 's' } });
    } catch (error) {
      expect((error as MissingOutputsError).missing).toEqual(['risk']);
    }
  });

  it('accepts null for a gate with only control ports and refuses anything else', () => {
    expect(buildGateResolution(none, gateId, { answer: null }).value).toEqual({ onSuccess: true });
    expect(() => buildGateResolution(none, gateId, { answer: 'x' })).toThrow(InvalidAnswerError);
  });

  it('rejects by flipping control ports and nulling every output', () => {
    expect(buildGateResolution(multi, gateId, { reject: 'no' }).value).toEqual({
      onSuccess: false,
      onFailure: true,
      summary: null,
      risk: null,
    });
  });

  it('refuses values the wire format cannot carry, with a readable message', () => {
    expect(() => buildGateResolution(single, gateId, { answer: { when: new Date() } })).toThrow(
      InvalidAnswerError,
    );
    expect(() => buildGateResolution(single, gateId, { answer: { f: () => 1 } })).toThrow(
      InvalidAnswerError,
    );
  });
});
