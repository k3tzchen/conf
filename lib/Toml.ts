export function parse<T>(toml: string): T {
  return Bun.TOML.parse(toml) as T;
}

function escapeString(str: string): string {
  if (str.includes('\n')) return `"""${str.replace(/"/g, '\\"')}"""`;

  return JSON.stringify(str);
}

function serializeValue(value: any): string  {
 if (typeof value === 'string') return escapeString(value);
 if (typeof value === 'number' || typeof value === 'boolean') return String(value);
 if (Array.isArray(value)) return `[\n  ${value.map(serializeValue).join(',\n  ')},\n]`;
 if (value && typeof value === 'object') return `{ ${Object.entries(value).map(([k, v]) => `${k} = ${serializeValue(v)}`).join(', ')} }`;

 return '';
}

function isLeafObject(obj: Record<string, unknown>): boolean {
  return Object.values(obj).every(v => typeof v !== 'object' || v === null || Array.isArray(v));
}

function serialize(obj: any, parentKey: string[] = []): string {
  let toml = '';
  const scalars: string[] = [];
  const objects: string[] = [];

  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const value = obj[key];
    (typeof value === 'object' && value !== null && !Array.isArray(value) ? objects : scalars).push(key);
  }

  for (const key of scalars) {
    const val = serializeValue(obj[key]);
    if (val.trim()) toml += `${key} = ${val}\n`;
  }

  for (const key of objects) {
    const fullKey = [...parentKey, key];
    const value = obj[key];
    if (toml) toml += '\n';
    if (isLeafObject(value) || parentKey.length === 0) toml += `[${fullKey.join('.')}]\n`;
    toml += serialize(value, fullKey);
  }

  return toml;
}

export function stringify(toml: Record<string, unknown>): string {
  return serialize(toml);
}

export default { parse, stringify };
