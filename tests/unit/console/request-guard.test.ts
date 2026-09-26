/**
 * The console has no login: it trusts whoever can reach it, which on the
 * loopback interface is the person at this machine. A web page they have
 * open can reach it too. These are the two ways that page could act on the
 * console, and the guard refuses both:
 *
 * - DNS rebinding: a name the page controls is pointed at 127.0.0.1, so the
 *   browser treats the console as that page's own origin. The Host header
 *   still carries the page's name.
 * - Cross-site requests: a form or a no-cors fetch sends a POST without a
 *   preflight. The browser still says where it came from in Origin.
 */
import { describe, it, expect } from 'vitest';
import { refusal } from '../../../src/console/request-guard.js';

const req = (method: string, headers: Record<string, string | undefined>) => ({ method, headers });

describe('the console request guard', () => {
  describe('on a loopback address', () => {
    const bound = '127.0.0.1';

    it('lets the console page itself through, by any loopback name', () => {
      for (const host of ['127.0.0.1:4311', 'localhost:4311', 'LOCALHOST:4311', '[::1]:4311', 'localhost']) {
        expect(refusal(req('GET', { host }), bound)).toBeUndefined();
        expect(refusal(req('POST', { host, origin: `http://${host}` }), bound)).toBeUndefined();
      }
    });

    it('lets a client without a browser through: no Origin header', () => {
      expect(refusal(req('POST', { host: '127.0.0.1:4311' }), bound)).toBeUndefined();
      expect(refusal(req('DELETE', { host: 'localhost:4311' }), bound)).toBeUndefined();
    });

    it('refuses a Host that is not a loopback name, whatever the method', () => {
      for (const method of ['GET', 'POST']) {
        expect(refusal(req(method, { host: 'attacker.example:4311' }), bound)).toMatch(/Host/);
        expect(refusal(req(method, { host: '192.168.1.20:4311' }), bound)).toMatch(/Host/);
        expect(refusal(req(method, { host: 'localhost.attacker.example' }), bound)).toMatch(/Host/);
      }
    });

    it('refuses a request with no Host at all', () => {
      expect(refusal(req('GET', {}), bound)).toBe('the request has no Host header');
      expect(refusal(req('GET', { host: '' }), bound)).toBe('the request has no Host header');
    });

    it('refuses a Host that is not a single header value', () => {
      const repeated = { method: 'GET', headers: { host: ['127.0.0.1:4311', 'attacker.example'] } };
      expect(refusal(repeated, bound)).toBe('the request has no Host header');
    });

    it('reads a bracketed IPv6 address only at the start of the Host', () => {
      expect(refusal(req('GET', { host: 'attacker.example[::1]' }), bound)).toBe(
        'the console answers only to a loopback Host, not attacker.example[::1]',
      );
      expect(refusal(req('GET', { host: '[::1]' }), bound)).toBeUndefined();
    });

    it('treats a request without a method as a read', () => {
      expect(refusal({ headers: { host: '127.0.0.1:4311', origin: 'https://attacker.example' } }, bound)).toBeUndefined();
    });

    it('refuses a change whatever the case of its method', () => {
      expect(refusal(req('post', { host: '127.0.0.1:4311', origin: 'https://attacker.example' }), bound)).toBe(
        "a change is accepted only from the console's own origin, not https://attacker.example",
      );
      expect(refusal(req('options', { host: '127.0.0.1:4311', origin: 'https://attacker.example' }), bound)).toBeUndefined();
    });

    it('refuses a change sent from another origin', () => {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(refusal(req(method, { host: '127.0.0.1:4311', origin: 'https://attacker.example' }), bound)).toMatch(/origin/);
      }
    });

    it('refuses an origin that differs only by port, scheme or name', () => {
      const host = '127.0.0.1:4311';
      expect(refusal(req('POST', { host, origin: 'http://127.0.0.1:5173' }), bound)).toMatch(/origin/);
      expect(refusal(req('POST', { host, origin: 'https://127.0.0.1:4311' }), bound)).toMatch(/origin/);
      expect(refusal(req('POST', { host, origin: 'http://localhost:4311' }), bound)).toMatch(/origin/);
    });

    it('refuses the opaque origin a sandboxed frame or a file sends', () => {
      expect(refusal(req('POST', { host: '127.0.0.1:4311', origin: 'null' }), bound)).toMatch(/origin/);
    });

    it('lets a read from another origin through: the browser keeps the answer from that page', () => {
      expect(refusal(req('GET', { host: '127.0.0.1:4311', origin: 'https://attacker.example' }), bound)).toBeUndefined();
      expect(refusal(req('HEAD', { host: '127.0.0.1:4311', origin: 'https://attacker.example' }), bound)).toBeUndefined();
    });
  });

  describe('on a reachable address, chosen with --insecure', () => {
    const bound = '0.0.0.0';

    it('accepts any Host, since the console is meant to be reached by name or address', () => {
      expect(refusal(req('GET', { host: '192.168.1.20:4311' }), bound)).toBeUndefined();
      expect(refusal(req('POST', { host: 'devbox.lan:4311', origin: 'http://devbox.lan:4311' }), bound)).toBeUndefined();
    });

    it('still refuses a change sent from another origin', () => {
      expect(refusal(req('POST', { host: 'devbox.lan:4311', origin: 'https://attacker.example' }), bound)).toMatch(/origin/);
    });
  });
});
