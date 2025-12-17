import { isBun } from 'process';
import Throwable from './lib/Throwable';

if (!isBun) {
  throw new Throwable('UnsupportedRuntimeError', 'ConfLoader requires the Bun runtime.', 'Please use Bun: https://bun.sh/');
}

import { join, normalize } from 'path';
import { rename } from 'fs/promises';

import Toml from './lib/Toml';
import Config from './lib/Config';
import VersionManager, { ConfigDir } from './lib/VersionManager';

const ConfigCache = new Map<string, Config<any, any>>();

async function configDirExists(): Promise<boolean> {
  try {
    const stat = await ConfigDir.stat();
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function makeConfigPath<K extends keyof ConfLoaderRegistry, V extends (VersionString & keyof ConfLoaderRegistry[K])>(name: K, version: V | 'latest' = 'latest'): string {
  return join(ConfigDir.name!, `${normalize(name)}/${version}.toml`);
}

/**
 * Returns rather a config with that name and (if given) version exists.
 *
 * ---
 *
 * @throws when the .config path does not exists in the root directory
 */
export async function exists<K extends keyof ConfLoaderRegistry, V extends (VersionString & keyof ConfLoaderRegistry[K])>(name: K, version: V | 'latest' = 'latest'): Promise<boolean> {
  if (!(await configDirExists())) {
    throw new Throwable('ReferenceError', `'${ConfigDir.name!}': No such directory`, "Create a '.config' in the root of your project folder");
  }

  version = await VersionManager.resolve<K, V>(name, version);

  if (ConfigCache.has(`${name}@${version}`)) return true;

  const ConfigFile = Bun.file(makeConfigPath(name, version));

  try {
    const stat = await ConfigFile.stat();
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Loads and returns the config values
 *
 * ---
 *
 * @throws if the config does not exist, or the given version does not exist.
 */
export async function load<K extends keyof ConfLoaderRegistry, V extends (VersionString & keyof ConfLoaderRegistry[K])>(name: K, version: V | 'latest' = 'latest'): Promise<Config<K, V>> {
  version = await VersionManager.resolve<K, V>(name, version);

  const cacheKey = `${name}@${version}`;
  if (!ConfigCache.has(cacheKey)) {
    const configPath = makeConfigPath(name, version);

    if (!await exists(name, version)) {
      throw new Throwable('ReferenceError', `'${configPath}': No such file`, 'Make sure you either created the file manual or used `ConfLoader.write`/`ConfLoader.migrate` before loading the config.');
    }

    const ConfigFile = Bun.file(configPath);
    ConfigCache.set(cacheKey, new Config<K, V>(Toml.parse<ConfigType<K, V>>(await ConfigFile.text())));
  }

  return ConfigCache.get(cacheKey)!;
}

/**
 * Write a TOML config into the .config folder with the format of `{name}[v{version}].toml`
 *
 * ---
 *
 * @throws when `overwriteExisting` is not given or set to false and the config with that name and version already exists.
 */
export async function write<K extends keyof ConfLoaderRegistry, V extends (VersionString & keyof ConfLoaderRegistry[K])>({ name, version, preset, allowOverwrites = false }: WriteOptions<K, V>): Promise<void> {
  const configPath = makeConfigPath(name, VersionManager.convert(version));
  if (await exists(name, version as V) && !allowOverwrites) {
    throw new Throwable('IOError', `Tried to overwrite '${configPath}'`, 'If this was intentional include the field `allowOverwrites: true` in your WriteOptions.');
  }

  const tempPath = `${configPath}.${Bun.randomUUIDv7('hex')}`;

  try {
    await Bun.write(tempPath, Toml.stringify(preset as any), { createPath: true });
    await rename(tempPath, configPath);
  } finally {
    const tmpFile = Bun.file(tempPath);
    if (await tmpFile.exists()) await tmpFile.delete();
  }
}

/** Migrates a config from one version to another. Returns a function for optional deletion of the old config file. */
export async function migrate<K extends keyof ConfLoaderRegistry, O extends (VersionString & keyof ConfLoaderRegistry[K]), V extends Exclude<(VersionString & keyof ConfLoaderRegistry[K]), O>>(name: K, oldVersion: O, newVersion: V, callback: (oldVer: Config<K, O>) => ConfigType<K, V> | Promise<ConfigType<K, V>>): Promise<() => Promise<void>> {
  if (typeof callback != 'function') {
    throw new Throwable('TypeError', 'Callback was expected to be a function');
  }

  const version = await VersionManager.resolve<K, V>(name, oldVersion);
  const oldConfig = await load(name, oldVersion);

  await write({
    name,
    version: newVersion,
    preset: await Promise.resolve(callback(oldConfig)),
    allowOverwrites: true
  });

  const ConfigFile = Bun.file(makeConfigPath(name, version));

  async function deleteConfig() {
    const cacheKey = `${name}@${version}`;
    if (ConfigCache.has(cacheKey)) ConfigCache.delete(cacheKey);
    await ConfigFile.delete();
  }

  return deleteConfig.bind(null);
}

export default { exists, load, write, migrate };
