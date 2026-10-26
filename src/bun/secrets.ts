// Credentials live in the OS keychain under service `com.lectern.app`, one entry per key the page uses (the account
// index, each account's tokens). The names are the Rust build's (`keyring::Entry::new(SERVICE, key)`), so signed-in
// accounts survive the move to Electrobun.
//
// macOS reads the old entries as they are. On Windows and Linux the Rust `keyring` crate stored them in its own
// format, so a miss falls back to that format once and copies the value over to Bun's.
import type { Pointer } from 'bun:ffi';
import { IDENTIFIER } from './paths';

/** `LECTERN_KEYCHAIN_SERVICE` lets tests and throwaway runs use a keychain namespace that holds no real accounts. */
export const SERVICE = process.env.LECTERN_KEYCHAIN_SERVICE || IDENTIFIER;

/** Seam for tests, which must never touch the real keychain. */
export interface Keychain {
  get(service: string, name: string): Promise<string | null>;
  set(service: string, name: string, value: string): Promise<void>;
  delete(service: string, name: string): Promise<boolean>;
  /** Entries written by the Rust build, where their format differs from Bun's. */
  legacy?: {
    get(service: string, name: string): Promise<string | null>;
    delete(service: string, name: string): Promise<void>;
  };
}

/** keyring-rs: a generic credential named `<account>.<service>` holding UTF-16. */
async function windowsLegacy(service: string, name: string, op: 'read' | 'delete'): Promise<string | null> {
  const { dlopen, ptr, read, toArrayBuffer } = await import('bun:ffi');
  const lib = dlopen('advapi32.dll', {
    CredReadW: { args: ['ptr', 'u32', 'u32', 'ptr'], returns: 'i32' },
    CredDeleteW: { args: ['ptr', 'u32', 'u32'], returns: 'i32' },
    CredFree: { args: ['ptr'], returns: 'void' }
  });
  try {
    const target = Buffer.from(`${name}.${service}\0`, 'utf16le');
    const CRED_TYPE_GENERIC = 1;
    if (op === 'delete') {
      lib.symbols.CredDeleteW(ptr(target), CRED_TYPE_GENERIC, 0);
      return null;
    }
    const out = new BigUint64Array(1);
    if (!lib.symbols.CredReadW(ptr(target), CRED_TYPE_GENERIC, 0, ptr(out))) return null;
    const cred = Number(out[0]) as Pointer;
    try {
      // CREDENTIALW on 64-bit: CredentialBlobSize at 32, CredentialBlob at 40.
      const size = read.u32(cred, 32);
      const blob = Number(read.ptr(cred, 40)) as Pointer;
      if (!size || !blob) return '';
      return Buffer.from(toArrayBuffer(blob, 0, size).slice(0)).toString('utf16le');
    } finally {
      lib.symbols.CredFree(cred);
    }
  } finally {
    lib.close();
  }
}

/** keyring-rs: a Secret Service item keyed by `service` and `username`. Needs `secret-tool`. */
async function linuxLegacy(service: string, name: string): Promise<string | null> {
  if (!Bun.which('secret-tool')) return null;
  const p = Bun.spawn(['secret-tool', 'lookup', 'service', service, 'username', name], { stdout: 'pipe', stderr: 'ignore' });
  const out = await new Response(p.stdout).text();
  return (await p.exited) === 0 && out !== '' ? out : null;
}

async function linuxLegacyDelete(service: string, name: string): Promise<void> {
  if (!Bun.which('secret-tool')) return;
  await Bun.spawn(['secret-tool', 'clear', 'service', service, 'username', name], { stdout: 'ignore', stderr: 'ignore' }).exited;
}

export const bunKeychain: Keychain = {
  get: (service, name) => Bun.secrets.get({ service, name }),
  set: (service, name, value) => Bun.secrets.set({ service, name, value }),
  delete: (service, name) => Bun.secrets.delete({ service, name }),
  legacy:
    process.platform === 'win32'
      ? { get: (service, name) => windowsLegacy(service, name, 'read'), delete: async (service, name) => void (await windowsLegacy(service, name, 'delete')) }
      : process.platform === 'linux'
        ? { get: linuxLegacy, delete: linuxLegacyDelete }
        : undefined
};

let keychain: Keychain = bunKeychain;

export function useKeychain(k: Keychain | null) {
  keychain = k ?? bunKeychain;
}

export async function secretGet(args: { key: string }): Promise<string | null> {
  const { key } = args;
  const value = (await keychain.get(SERVICE, key)) ?? null;
  if (value !== null || !keychain.legacy) return value;
  const old = await keychain.legacy.get(SERVICE, key);
  if (old === null) return null;
  try {
    await keychain.set(SERVICE, key, old);
    // Left behind, the old entry would bring the secret back after the page deletes it.
    await keychain.legacy.delete(SERVICE, key);
  } catch (err) {
    console.warn(`could not migrate a keychain entry: ${err}`);
  }
  return old;
}

export async function secretSet(args: { key: string; value: string }): Promise<void> {
  await keychain.set(SERVICE, args.key, args.value);
}

export async function secretDelete(args: { key: string }): Promise<void> {
  await keychain.delete(SERVICE, args.key);
  await keychain.legacy?.delete(SERVICE, args.key);
}
