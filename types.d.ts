type ConfigVariableKey<T, Prefix extends string = ''> = {
  [K in keyof T]: T[K] extends object
    ? T[K] extends Array<any>
      ? `${Prefix}${K & string}`
      : ConfigVariableKey<T[K], `${Prefix}${K & string}.`>
    : `${Prefix}${K & string}`
}[keyof T];

type Split<S extends string, D extends string = "."> = string extends S
  ? string[]
  : S extends ""
    ? []
    : S extends `${infer T}${D}${infer U}`
      ? [T, ...Split<U, D>]
      : [S];

type DeepPickRequired<T, Path extends readonly string[]> = Path extends [infer K, ...infer Rest]
  ? K extends keyof T
    ? { [P in K & string]: DeepPickRequired<T[P], Extract<Rest, string[]>> }
    : never
  : T;

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

type PickConfigObject<T, Paths extends readonly string[]> = UnionToIntersection<DeepPickRequired<T, Split<Paths[number]>>>;

declare global {
  interface ConfLoaderRegistry { }
}

type ConfigPresetType<K extends keyof ConfLoaderRegistry, V extends ConfigVersions<K>> = ConfLoaderRegistry[K][V];
type ConfigVersions<K extends keyof ConfLoaderRegistry, E extends any = never> = Exclude<VersionString & keyof ConfLoaderRegistry[K], E>;

type VersionString = `v${number}${'' | `.${number}${'' | `.${number}`}${'' | `-${string}`}`}`;

interface VersionObject {
  major: number;
  minor: number;
  patch: number;
  label?: string;
}

interface WriteOptions<K extends keyof ConfLoaderRegistry, V extends ConfigVersions<K>> {
  /** Name of the config */
  name: K;
  /** The Version you want to write */
  version: Exclude<V, 'latest'>,
  /** Its object representation */
  preset: ConfigPresetType<K, V>;
  /** If overwitres should be allowed. */
  allowOverwrites?: boolean;
}
