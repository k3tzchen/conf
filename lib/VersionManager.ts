import { join } from 'path';
import { readdir } from 'fs/promises';

import Throwable from "./Throwable";

const CWD = process.cwd();
export const ConfigDir = Bun.file(join(CWD, '.config'));

function parseIntSafe(n: any, fallback?: number): number {
  const number = parseInt(n, 10);
  if (!Number.isFinite(number)) return fallback ?? 0;
  return number;
}

export function convert<V extends VersionString>(version: V | number): V {
  if (typeof version == 'string' && !/^v(\d+(?:\.\d+)?(?:\.\d+)?(?:-[a-z0-9]+)?)$/i.test(version)) {
    throw new Throwable('SyntaxError', `'${version}' has invalid syntax.`, "Example of valid formats: v1, v1.2, v1.2.3, v1.2.3-beta");
  }
  else if (typeof version == 'number' && !Number.isFinite(version)) {
    throw new Throwable('RangeError', 'Major is not finite', 'Make sure to not pass NaN or Infinity values');
  }

  if (typeof version == 'number') version = `v${version}` as V;

  return version;
}

export function parse(version: VersionString | number): VersionObject {
  version = convert(version);


  const versionRegex = /^v(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([a-z0-9]+)?)?$/i;
  const match = version.match(versionRegex);

  if (!match) {
    throw new Throwable('SyntaxError', `'${version}' has invalid syntax.`, "Example of valid formats: v1, v1.2, v1.2.3, v1.2.3-beta");
  }

  const [major, minor, patch, label] = match.slice(1);

  return {
    major: parseIntSafe(major, 1),
    minor: parseIntSafe(minor, 0),
    patch: parseIntSafe(patch, 0),
    label
  }
}

export async function resolve<K extends keyof ConfLoaderRegistry, V extends VersionString>(name: K, version?: any): Promise<V> {
  if ((version as (V | 'latest')) == 'latest') {
    version = void 0;

    const files = (await readdir(join(ConfigDir.name!, name))).filter(e => e.endsWith('.toml'));
    const regex = /^(v(\d+(?:\.\d+)?(?:\.\d+)?(?:-[a-z0-9]+)?)?)\.toml$/i;
    const versions = files.map(line => line.match(regex)?.[1]).filter(Boolean) as string[];

    if (versions.length > 0) {
      version = versions[0]!;

      if (versions.length > 1) {
        for (const v of versions.slice(1)) {
          const ver = v.split('-')[0]!.slice(1);
          if (version && Bun.semver.order(ver, version.split('-')[0]!.slice(1)) === 1) version = v;
        }
      }
    }
  }

  if (version == void 0) version = 1;
  version = convert<V>(version as V);

  return version;
}

export default { convert, parse, resolve };
