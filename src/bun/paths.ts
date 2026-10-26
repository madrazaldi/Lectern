// Where the app keeps its files. These are the places the Tauri build used (its `app_data_dir`), so downloads made
// before the move to Electrobun are still found.
import { homedir } from 'node:os';
import { join } from 'node:path';

export const IDENTIFIER = 'com.lectern.app';

/** `~/Library/Application Support/com.lectern.app`, `%APPDATA%\com.lectern.app` or `~/.local/share/com.lectern.app`. */
export function dataDir(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform): string {
  // For tests and throwaway runs.
  if (env.LECTERN_DATA_DIR) return env.LECTERN_DATA_DIR;
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  switch (platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', IDENTIFIER);
    case 'win32':
      return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), IDENTIFIER);
    default:
      return join(env.XDG_DATA_HOME || join(home, '.local', 'share'), IDENTIFIER);
  }
}

/** Tauri's `app_config_dir`: the data directory, except on Linux, where it is `~/.config/com.lectern.app`. */
export function configDir(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'linux' || env.LECTERN_DATA_DIR) return dataDir(env, platform);
  return join(env.XDG_CONFIG_HOME || join(env.HOME ?? homedir(), '.config'), IDENTIFIER);
}

export const downloadsRoot = () => join(dataDir(), 'downloads');
