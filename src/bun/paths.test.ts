import { describe, expect, it } from 'bun:test';
import { configDir, dataDir, downloadsRoot, IDENTIFIER } from './paths';

describe('data directory', () => {
  it('is where the Tauri build kept things', () => {
    expect(IDENTIFIER).toBe('com.lectern.app');
    expect(dataDir({ HOME: '/Users/a' }, 'darwin')).toBe('/Users/a/Library/Application Support/com.lectern.app');
    expect(dataDir({ HOME: '/home/a' }, 'linux')).toBe('/home/a/.local/share/com.lectern.app');
    expect(dataDir({ HOME: '/home/a', XDG_DATA_HOME: '/data' }, 'linux')).toBe('/data/com.lectern.app');
    expect(dataDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32')).toContain('com.lectern.app');
  });

  it('keeps settings where Tauri kept its config', () => {
    expect(configDir({ HOME: '/home/a' }, 'linux')).toBe('/home/a/.config/com.lectern.app');
    expect(configDir({ HOME: '/home/a', XDG_CONFIG_HOME: '/conf' }, 'linux')).toBe('/conf/com.lectern.app');
    expect(configDir({ HOME: '/Users/a' }, 'darwin')).toBe(dataDir({ HOME: '/Users/a' }, 'darwin'));
    expect(configDir({ HOME: '/home/a', LECTERN_DATA_DIR: '/tmp/x' }, 'linux')).toBe('/tmp/x');
  });

  it('can be pointed somewhere else for throwaway runs', () => {
    expect(dataDir({ HOME: '/Users/a', LECTERN_DATA_DIR: '/tmp/x' }, 'darwin')).toBe('/tmp/x');
  });

  it('keeps downloads in a downloads folder', () => {
    expect(downloadsRoot().endsWith('/downloads') || downloadsRoot().endsWith('\\downloads')).toBe(true);
  });
});
