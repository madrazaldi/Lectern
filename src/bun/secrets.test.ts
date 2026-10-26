import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { bunKeychain, SERVICE, secretDelete, secretGet, secretSet, useKeychain, type Keychain } from './secrets';

/** An in-memory keychain, so none of these touch the real one. */
function fake(legacy?: Map<string, string>) {
  const items = new Map<string, string>();
  const calls: string[] = [];
  const k: Keychain = {
    async get(service, name) {
      return items.get(`${service}/${name}`) ?? null;
    },
    async set(service, name, value) {
      calls.push(`set ${service}/${name}`);
      items.set(`${service}/${name}`, value);
    },
    async delete(service, name) {
      return items.delete(`${service}/${name}`);
    },
    legacy: legacy && {
      async get(service, name) {
        return legacy.get(`${service}/${name}`) ?? null;
      },
      async delete(service, name) {
        legacy.delete(`${service}/${name}`);
      }
    }
  };
  return { k, items, calls };
}

afterEach(() => useKeychain(null));

describe('keychain commands', () => {
  it('uses the service name the Rust build used', () => {
    // Test runs may override it, but the default must never drift: it names the user's existing entries.
    if (!process.env.LECTERN_KEYCHAIN_SERVICE) expect(SERVICE).toBe('com.lectern.app');
  });

  it('stores, reads and deletes one entry per key', async () => {
    const { k, items } = fake();
    useKeychain(k);
    expect(await secretGet({ key: 'accounts' })).toBeNull();
    await secretSet({ key: 'accounts', value: '["a"]' });
    await secretSet({ key: 'account:a', value: '{"token":"t"}' });
    expect(await secretGet({ key: 'accounts' })).toBe('["a"]');
    expect([...items.keys()].sort()).toEqual([`${SERVICE}/account:a`, `${SERVICE}/accounts`]);
    await secretDelete({ key: 'accounts' });
    expect(await secretGet({ key: 'accounts' })).toBeNull();
    expect(await secretGet({ key: 'account:a' })).toBe('{"token":"t"}');
  });

  it('deleting something that is not there is fine', async () => {
    useKeychain(fake().k);
    await secretDelete({ key: 'nope' });
  });
});

describe('entries from the Rust build on Windows and Linux', () => {
  it('finds one in the old format, moves it, and does not leave a copy behind', async () => {
    const old = new Map([[`${SERVICE}/accounts`, 'old value']]);
    const { k, items } = fake(old);
    useKeychain(k);
    expect(await secretGet({ key: 'accounts' })).toBe('old value');
    expect(items.get(`${SERVICE}/accounts`)).toBe('old value');
    expect(old.size).toBe(0);
  });

  it('prefers the new entry', async () => {
    const old = new Map([[`${SERVICE}/accounts`, 'old']]);
    const { k } = fake(old);
    useKeychain(k);
    await secretSet({ key: 'accounts', value: 'new' });
    expect(await secretGet({ key: 'accounts' })).toBe('new');
  });

  it('deleting removes the old one too, so it cannot come back', async () => {
    const old = new Map([[`${SERVICE}/accounts`, 'old']]);
    useKeychain(fake(old).k);
    await secretDelete({ key: 'accounts' });
    expect(await secretGet({ key: 'accounts' })).toBeNull();
    expect(old.size).toBe(0);
  });

  it('still returns the value when the move fails', async () => {
    const old = new Map([[`${SERVICE}/accounts`, 'old']]);
    const { k } = fake(old);
    k.set = async () => {
      throw new Error('denied');
    };
    useKeychain(k);
    expect(await secretGet({ key: 'accounts' })).toBe('old');
    expect(old.size).toBe(1);
  });
});

// The real thing, on a namespace that holds no real accounts. macOS only: elsewhere CI has no unlocked keyring.
const TEST_SERVICE = `com.lectern.app.test.${process.pid}`;
describe.skipIf(process.platform !== 'darwin' || !process.env.LECTERN_REAL_KEYCHAIN_TEST)('Bun.secrets', () => {
  afterAll(async () => {
    await bunKeychain.delete(TEST_SERVICE, 'k1');
  });

  it('round-trips through the real keychain', async () => {
    await bunKeychain.set(TEST_SERVICE, 'k1', '{"a":"ü"}');
    expect(await bunKeychain.get(TEST_SERVICE, 'k1')).toBe('{"a":"ü"}');
    expect(await bunKeychain.delete(TEST_SERVICE, 'k1')).toBe(true);
    expect(await bunKeychain.get(TEST_SERVICE, 'k1')).toBeNull();
  });
});
