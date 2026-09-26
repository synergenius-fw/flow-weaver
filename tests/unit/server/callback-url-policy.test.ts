/**
 * Which callback URLs a server accepts, checked when a run starts: the
 * address ranges that count as private, the host names that are private by
 * name, and the three ways an embedding sets its own policy (allow private
 * addresses, name the hosts, or decide itself). The address a callback is
 * finally delivered to is covered in callback-url.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { isPrivateAddress, refuseCallbackUrl, callbackTarget, type Resolve } from '../../../src/server/callback-url.js';

const resolvesTo = (...addresses: string[]): Resolve => async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
const noLookup: Resolve = async () => { throw new Error('no lookup expected'); };
const PUBLIC = resolvesTo('93.184.216.34');

describe('private addresses', () => {
  it('covers each IPv4 range a public server should not reach, edge to edge', () => {
    for (const ip of [
      '10.0.0.0', '10.255.255.255',        // private
      '127.0.0.1', '127.255.255.254',      // loopback
      '0.0.0.0', '0.1.2.3',                // this network
      '169.254.0.1', '169.254.169.254',    // link local, cloud metadata
      '172.16.0.1', '172.31.255.255',      // private
      '192.168.0.1', '192.168.255.255',    // private
      '100.64.0.1', '100.127.255.255',     // carrier-grade NAT
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('leaves the addresses just outside those ranges public', () => {
    for (const ip of [
      '9.255.255.255', '11.0.0.0', '126.255.255.255', '128.0.0.1', '1.0.0.0',
      '169.253.0.1', '169.255.0.1', '168.254.0.1',
      '172.15.255.255', '172.32.0.0', '171.16.0.1',
      '192.167.0.1', '192.169.0.1', '191.168.0.1',
      '100.63.255.255', '100.128.0.0', '101.64.0.1',
      '93.184.216.34', '8.8.8.8',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('covers the IPv6 loopback, unspecified, unique local and link local ranges', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fdff::1', 'fe80::1', 'febf::1', 'FE80::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['2001:db8::1', '2606:4700::1111', '::fc', 'fec0::1', 'fe7f::1', 'ff02::1']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('reads an IPv4 address mapped into IPv6 as the IPv4 address it is', () => {
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:192.168.10.10')).toBe(true);
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
    // The same addresses as the URL parser and some resolvers spell them.
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateAddress('::ffff:a9fe:a9fe')).toBe(true);
    expect(isPrivateAddress('::ffff:808:808')).toBe(false);
  });

  it('reads an IPv6 address the same however it is spelled', () => {
    expect(isPrivateAddress('0:0:0:0:0:0:0:1')).toBe(true);
    expect(isPrivateAddress('0000:0000:0000:0000:0000:ffff:7f00:0001')).toBe(true);
  });

  it('is false for anything that is not an address', () => {
    for (const s of ['fc.example.com', 'fd', 'localhost', '', '10.0.0']) {
      expect(isPrivateAddress(s), s).toBe(false);
    }
  });
});

describe('refusing a callback URL when a run starts', () => {
  it('refuses a URL that does not parse, or is not http or https', async () => {
    expect(await refuseCallbackUrl('not a url', {}, noLookup)).toBe('not a valid URL');
    expect(await refuseCallbackUrl('ftp://example.com/x', {}, noLookup)).toBe('only http and https callbacks are delivered');
    expect(await refuseCallbackUrl('file:///etc/passwd', {}, noLookup)).toBe('only http and https callbacks are delivered');
  });

  it('refuses credentials in the URL, a user name alone included', async () => {
    expect(await refuseCallbackUrl('https://u@example.com/x', {}, noLookup)).toBe('credentials in the URL are not allowed');
    expect(await refuseCallbackUrl('https://:p@example.com/x', {}, noLookup)).toBe('credentials in the URL are not allowed');
  });

  it('refuses private host names without looking them up', async () => {
    for (const host of ['localhost', 'app.localhost', 'printer.local', 'db.internal', 'LOCALHOST']) {
      expect(await refuseCallbackUrl(`http://${host}:9000/x`, {}, noLookup)).toBe(
        `${host.toLowerCase()} is a private host, and callbacks go to public addresses only`,
      );
    }
  });

  it('looks up any other name, and accepts it when every address is public', async () => {
    for (const host of ['localhost.example.com', 'local.example.com', 'internal.example.com', 'example.com']) {
      expect(await refuseCallbackUrl(`https://${host}/x`, {}, PUBLIC), host).toBeUndefined();
      expect(await refuseCallbackUrl(`https://${host}/x`, {}, resolvesTo('10.0.0.1')), host).toBe(
        `${host} resolves to 10.0.0.1, a private address, and callbacks go to public addresses only`,
      );
    }
  });

  it('refuses a name that resolves to nothing', async () => {
    expect(await refuseCallbackUrl('https://void.example.com/x', {}, resolvesTo())).toBe('void.example.com does not resolve');
    expect(await refuseCallbackUrl('https://void.example.com/x', {}, noLookup)).toBe('void.example.com does not resolve');
  });

  it('refuses a private address literal, in either IP version', async () => {
    expect(await refuseCallbackUrl('http://10.1.2.3/x', {}, noLookup)).toBe('10.1.2.3 is a private address, and callbacks go to public addresses only');
    expect(await refuseCallbackUrl('http://[fd00::1]/x', {}, noLookup)).toBe('fd00::1 is a private address, and callbacks go to public addresses only');
    expect(await refuseCallbackUrl('http://[2001:db8::1]:8080/x', {}, noLookup)).toBeUndefined();
  });

  it('refuses a private IPv4 address written as a mapped IPv6 address', async () => {
    // The URL parser turns [::ffff:127.0.0.1] into [::ffff:7f00:1].
    expect(await refuseCallbackUrl('http://[::ffff:127.0.0.1]/x', {}, noLookup)).toMatch(/private address/);
    expect(await refuseCallbackUrl('http://[::ffff:169.254.169.254]/latest/meta-data', {}, noLookup)).toMatch(/private address/);
    expect(await callbackTarget('http://[::ffff:10.0.0.1]/x', {}, noLookup)).toEqual({ refused: expect.stringMatching(/private address/) });
    expect(await refuseCallbackUrl('http://[::ffff:8.8.8.8]/x', {}, noLookup)).toBeUndefined();
  });

  it('allows private hosts and addresses when the policy allows private ones, without a lookup', async () => {
    expect(await refuseCallbackUrl('http://localhost:9000/x', { allowPrivate: true }, noLookup)).toBeUndefined();
    expect(await refuseCallbackUrl('http://10.0.0.1/x', { allowPrivate: true }, noLookup)).toBeUndefined();
  });
});

describe('a policy that names its hosts', () => {
  it('accepts any of the named hosts, compared without case, and nothing else', async () => {
    const policy = { hosts: ['a.example.com', 'B.Example.com'] };
    expect(await refuseCallbackUrl('https://a.example.com/x', policy, noLookup)).toBeUndefined();
    expect(await refuseCallbackUrl('https://b.example.com/x', policy, noLookup)).toBeUndefined();
    expect(await refuseCallbackUrl('https://c.example.com/x', policy, noLookup)).toBe('c.example.com is not among the hosts this server delivers callbacks to');
  });

  it('matches a wildcard against subdomains only, not the domain itself or a look-alike', async () => {
    const policy = { hosts: ['*.Example.com'] };
    expect(await refuseCallbackUrl('https://hooks.example.com/x', policy, noLookup)).toBeUndefined();
    expect(await refuseCallbackUrl('https://a.b.example.com/x', policy, noLookup)).toBeUndefined();
    for (const host of ['example.com', 'badexample.com', '.example.com', 'example.com.evil.org']) {
      expect(await refuseCallbackUrl(`https://${host}/x`, policy, noLookup), host).toMatch(/not among/);
    }
  });

  it('trusts a named host even when it resolves to a private address', async () => {
    expect(await callbackTarget('http://hooks.internal/x', { hosts: ['hooks.internal'] }, resolvesTo('10.0.0.9'))).toMatchObject({ address: '10.0.0.9', family: 4 });
  });
});

describe('a policy that decides itself', () => {
  it('accepts what it allows, without a lookup, even a private host', async () => {
    const seen: string[] = [];
    const allow = (url: URL) => { seen.push(url.href); return true; };
    expect(await refuseCallbackUrl('http://localhost:9000/x', { allow }, noLookup)).toBeUndefined();
    expect(seen).toEqual(['http://localhost:9000/x']);
  });

  it('refuses with its own reason, or a default one when it gives none', async () => {
    expect(await refuseCallbackUrl('https://a.example.com/x', { allow: () => 'no thanks' }, noLookup)).toBe('no thanks');
    expect(await refuseCallbackUrl('https://a.example.com/x', { allow: () => false }, noLookup)).toBe("refused by the server's callback policy");
    expect(await callbackTarget('https://a.example.com/x', { allow: () => false }, noLookup)).toEqual({ refused: "refused by the server's callback policy" });
  });

  it('takes precedence over the host list and the private-address rule', async () => {
    const policy = { allow: () => true, hosts: ['only.example.com'] };
    expect(await refuseCallbackUrl('https://other.example.com/x', policy, noLookup)).toBeUndefined();
    expect(await callbackTarget('https://other.example.com/x', policy, resolvesTo('10.0.0.1'))).toMatchObject({ address: '10.0.0.1' });
  });
});
