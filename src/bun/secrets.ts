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

async function openLibsecret() {
  const { dlopen } = await import('bun:ffi');
  return {
    glib: dlopen('libglib-2.0.so.0', {
      g_hash_table_new: { args: ['ptr', 'ptr'], returns: 'ptr' },
      g_hash_table_insert: { args: ['ptr', 'ptr', 'ptr'], returns: 'i32' },
      g_hash_table_unref: { args: ['ptr'], returns: 'void' },
      g_error_free: { args: ['ptr'], returns: 'void' }
    }).symbols,
    secret: dlopen('libsecret-1.so.0', {
      secret_password_lookupv_sync: { args: ['ptr', 'ptr', 'ptr', 'ptr'], returns: 'ptr' },
      secret_password_clearv_sync: { args: ['ptr', 'ptr', 'ptr', 'ptr'], returns: 'i32' },
      secret_password_free: { args: ['ptr'], returns: 'void' }
    }).symbols
  };
}

// Opened once and never closed: libsecret registers GLib types that can't be registered again after a reload.
let libsecret: ReturnType<typeof openLibsecret> | undefined;

/**
 * keyring-rs: a Secret Service item keyed by `service` and `username`. Read through libsecret, which Bun.secrets needs
 * on Linux anyway, so no extra tool has to be installed.
 */
async function linuxLegacy(service: string, name: string, op: 'read' | 'delete'): Promise<string | null> {
  const { CString, ptr, read } = await import('bun:ffi');
  const { glib, secret } = await (libsecret ??= openLibsecret());
  const cstr = (v: string) => Buffer.from(`${v}\0`, 'utf8');
  // The table only borrows these, so they have to outlive it.
  const keep = [cstr('service'), cstr(service), cstr('username'), cstr(name)];
  const attrs = glib.g_hash_table_new(null, null);
  try {
    glib.g_hash_table_insert(attrs, ptr(keep[0]), ptr(keep[1]));
    glib.g_hash_table_insert(attrs, ptr(keep[2]), ptr(keep[3]));
    const error = new BigUint64Array(1);
    const check = () => {
      const err = Number(error[0]) as Pointer;
      if (!err) return;
      // GError: domain and code (4 bytes each), then the message.
      const message = new CString(read.ptr(err, 8) as Pointer).toString();
      glib.g_error_free(err);
      throw new Error(message);
    };
    // No schema: match on the attributes alone, as keyring-rs's own lookups do.
    if (op === 'delete') {
      secret.secret_password_clearv_sync(null, attrs, null, ptr(error));
      check();
      return null;
    }
    const found = secret.secret_password_lookupv_sync(null, attrs, null, ptr(error));
    check();
    if (!found) return null;
    try {
      return new CString(found).toString();
    } finally {
      secret.secret_password_free(found);
    }
  } finally {
    glib.g_hash_table_unref(attrs);
  }
}

export const bunKeychain: Keychain = {
  get: (service, name) => Bun.secrets.get({ service, name }),
  set: (service, name, value) => Bun.secrets.set({ service, name, value }),
  delete: (service, name) => Bun.secrets.delete({ service, name }),
  legacy:
    process.platform === 'win32'
      ? { get: (service, name) => windowsLegacy(service, name, 'read'), delete: async (service, name) => void (await windowsLegacy(service, name, 'delete')) }
      : process.platform === 'linux'
        ? { get: (service, name) => linuxLegacy(service, name, 'read'), delete: async (service, name) => void (await linuxLegacy(service, name, 'delete')) }
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
