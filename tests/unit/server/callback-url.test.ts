/**
 * Delivering a callback. The URL was checked when the run started, but the
 * run may wait days before it is delivered, and a name can resolve to a
 * public address when checked and a private one when fetched (DNS
 * rebinding). So delivery resolves the name once, checks that address, and
 * connects to exactly that address.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { callbackTarget, postCallback, type Resolve } from '../../../src/server/callback-url.js';

const resolvesTo = (...addresses: string[]): Resolve => async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

describe('the address a callback is delivered to', () => {
  it('is the address the name resolves to, when it is public', async () => {
    const t = await callbackTarget('https://hooks.example.com/done', {}, resolvesTo('93.184.216.34'));
    expect(t).toMatchObject({ address: '93.184.216.34', family: 4 });
  });

  it('is refused when the name now resolves to a private address', async () => {
    for (const ip of ['169.254.169.254', '10.1.2.3', '127.0.0.1', '::1', 'fd00::1']) {
      const t = await callbackTarget('https://hooks.example.com/done', {}, resolvesTo(ip));
      expect(t).toEqual({ refused: expect.stringContaining(ip) });
    }
  });

  it('is refused when any of the addresses is private, not only the first', async () => {
    const t = await callbackTarget('https://hooks.example.com/done', {}, resolvesTo('93.184.216.34', '10.0.0.1'));
    expect('refused' in t).toBe(true);
  });

  it('is refused when the name no longer resolves', async () => {
    const t = await callbackTarget('https://gone.example.com/', {}, async () => { throw new Error('ENOTFOUND'); });
    expect(t).toEqual({ refused: expect.stringContaining('does not resolve') });
  });

  it('keeps the checks on the URL itself', async () => {
    expect(await callbackTarget('ftp://x.example.com/', {}, resolvesTo('93.184.216.34'))).toEqual({ refused: expect.stringContaining('http') });
    expect(await callbackTarget('https://u:p@x.example.com/', {}, resolvesTo('93.184.216.34'))).toEqual({ refused: expect.stringContaining('credentials') });
    expect(await callbackTarget('http://10.0.0.5/', {}, resolvesTo())).toEqual({ refused: expect.stringContaining('private') });
  });

  it('uses an address literal as it is, without a lookup', async () => {
    const t = await callbackTarget('http://93.184.216.34:8080/x', {}, async () => { throw new Error('no lookup expected'); });
    expect(t).toMatchObject({ address: '93.184.216.34', family: 4 });
  });

  it('allows a private address when the policy allows private ones or names the host', async () => {
    expect(await callbackTarget('http://internal.example.com/', { allowPrivate: true }, resolvesTo('10.0.0.1'))).toMatchObject({ address: '10.0.0.1' });
    expect(await callbackTarget('http://internal.example.com/', { hosts: ['internal.example.com'] }, resolvesTo('10.0.0.1'))).toMatchObject({ address: '10.0.0.1' });
    expect(await callbackTarget('http://other.example.com/', { hosts: ['internal.example.com'] }, resolvesTo('10.0.0.1'))).toEqual({ refused: expect.stringContaining('not among') });
  });
});

describe('posting a callback', () => {
  let server: http.Server | undefined;
  afterEach(async () => { await new Promise<void>((r) => (server ? server.close(() => r()) : r())); server = undefined; });

  const listen = (handler: http.RequestListener) => new Promise<number>((resolve) => {
    server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port));
  });

  it('connects to the checked address while naming the host the URL gave', async () => {
    const seen: Array<{ host?: string; body: string; sig?: string }> = [];
    const port = await listen((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { seen.push({ host: req.headers.host, body, sig: req.headers['x-sig'] as string }); res.writeHead(204).end(); });
    });
    // callback.invalid cannot resolve: the post can only arrive through the pinned address.
    const status = await postCallback({ url: new URL(`http://callback.invalid:${port}/hook`), address: '127.0.0.1', family: 4 }, { 'x-sig': 'abc' }, '{"ok":true}', 5000);
    expect(status).toBe(204);
    expect(seen).toEqual([{ host: `callback.invalid:${port}`, body: '{"ok":true}', sig: 'abc' }]);
  });

  it('answers with a redirect status rather than following it', async () => {
    const port = await listen((_req, res) => { res.writeHead(302, { location: 'http://169.254.169.254/' }).end(); });
    expect(await postCallback({ url: new URL(`http://callback.invalid:${port}/`), address: '127.0.0.1', family: 4 }, {}, '{}', 5000)).toBe(302);
  });

  it('gives up after the timeout', async () => {
    const port = await listen(() => { /* never answers */ });
    await expect(postCallback({ url: new URL(`http://callback.invalid:${port}/`), address: '127.0.0.1', family: 4 }, {}, '{}', 200)).rejects.toThrow();
  });
});
