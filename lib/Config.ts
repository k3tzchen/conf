import Throwable from './Throwable';

namespace Utils {
  export function ensureObject<T extends object>(val?: T, fallback: T | null = null): T {
    return (typeof val === "object" && val !== null) ? val : fallback as T;
  }

  export function trimParens(str: string): string {
    if (typeof str !== 'string') return str;
    return str.replace(/^\((.*)\)$/,'$1').trim();
  }

  export function trimQuotes(str: string): string {
    if (typeof str !== 'string') return str;
    return str.replace(/^(['"])(.*)\1$/,'$2').trim();
  }

  const BooleanCheckMap = ['true', 'false'];
  export function parsePrimitiveValue(value: any): any {
    if (typeof value === 'string' && value.trim() !== '') {
      const lower = value.trim().toLowerCase();
      if (BooleanCheckMap.includes(lower)) return lower === 'true';
      const num = Number(value);
      if (Number.isFinite(num)) return num;
      try {
        return ensureObject(JSON.parse(value), value);
      } catch {}
    }
    return value;
  }

  export function findBalancedParenBlock(str: string, startIdx: number): [string, number] {
    let depth = 0;
    let i = startIdx;
    let block = '';
    let started = false;
    for (; i < str.length; i++) {
      const char = str[i];
      if (char === '(') {
        depth++;
        started = true;
      }
      if (char === ')') {
        depth--;
      }
      block += char;
      if (started && depth === 0) {
        break;
      }
    }
    return [block, i + 1];
  }

}

const ConditionOperators = ['equals', 'startswith', 'endswith', 'contains', '>', '>=', '<', '<='] as const;
type ConditionOperator = typeof ConditionOperators[number];

export default class Config<K extends keyof ConfLoaderRegistry, V extends (VersionString & keyof ConfLoaderRegistry[K])> {
  #config: Partial<ConfigType<K, V>> = {};
  #bank = new Map<ConfigVariableKey<ConfigType<K, V>>, string | void>;
  #dependencies = new Map<ConfigVariableKey<ConfigType<K, V>>, Set<ConfigVariableKey<ConfigType<K, V>>>>();

  #resolveConfigPath(path: ConfigVariableKey<ConfigType<K, V>>): any {
    if (path == void 0 || !(path as string)?.trim()) return void 0;

    return (path as string).split('.').reduce((obj, key) => obj?.[key], this.#config as any);
  }

  #resolveVariable(variable: string): string | void {
    if (!variable.startsWith('$')) return variable;

    variable = variable.slice(1);
    if (!variable?.trim()) return void 0;

    let value = this.#resolveConfigPath(variable as any);
    if (value === void 0) value = (Bun.env[variable] as string)?.trim();

    if (typeof value === 'string' && value.trim().startsWith('{{') && value.trim().endsWith('}}')) value = this.#evaluateLogicBlock(value.trim());

    return value;
  }

  #evaluateNullishCoalesce(content: string): any {
    const nullishCoalesceRegex = /^(?!if\s+)\s*(?<left>[\s\S]+?)\s*\?\?\s*(?<right>[\s\S]+?)\s*$/;
    const nullishMatch = content.match(nullishCoalesceRegex);

    if (nullishMatch) {
      let { left, right } = nullishMatch.groups ?? {} as { left: string; right: string; };

      left = Utils.trimParens(left!);
      left = this.#resolveVariable(Utils.trimParens(left!)) ?? '';
      if (left != '') return left;

      right = Utils.trimParens(right!);
      right = this.#resolveVariable(Utils.trimParens(right!)) ?? '';
      if (right != '') return right;
      return void 0;
    }

    return void 0;
  }

  #evaluateIfElseLogic(content: string): any {
    const ifThenElse = content.match(/^if\s+\(([\s\S]+?)\)\s+then\s+\(/i);
    if (!ifThenElse) return void 0;

    const condEnd = ifThenElse[0].length - 1;
    const [trueBlockWithParens, afterTrueIdx] = Utils.findBalancedParenBlock(content, condEnd);

    const afterTrue = content.slice(afterTrueIdx).trim();
    if (!afterTrue.startsWith('else')) return void 0;

    let elseBlock = afterTrue.slice(4).trim();

    if (elseBlock.startsWith('if')) {
      return this.#evaluateIfElseLogic(elseBlock);
    }

    if (!elseBlock.startsWith('(')) return void 0;
    const [falseBlockWithParens] = Utils.findBalancedParenBlock(elseBlock, 0);

    const condition = ifThenElse[1]!;
    const trueBlock = trueBlockWithParens.slice(1, -1);
    const falseBlock = falseBlockWithParens.slice(1, -1);

    const evalComparison = (cond: string): boolean => {
      const opRegex = new RegExp(`^\\s*([^\\s]+|\\([^\\)]+\\))\\s*(${ConditionOperators.map(op => op.replace(/([=^$*<>])/g, '\\$1')).join('|')})\\s*(['"].*?['"]|[^\\s]+)\\s*$`);
      const condMatch = Utils.trimParens(cond).match(opRegex);
      if (!condMatch) return false;
      let [, left, operator, right] = condMatch as any[];
      left = Utils.trimQuotes(left);
      right = Utils.trimQuotes(right);
      if ((left.trim() == '' && right.trim() != '') || (left.trim() != '' && right.trim() == '')) return false;

      const evaluate = (str: string) => this.#resolveVariable(Utils.trimQuotes(this.#evaluateLogicBlock(`{{ ${Utils.trimParens(str)} }}`)));

      left = evaluate(left);
      right = evaluate(right);

      if (/^[<>]/.test(operator)) {
        left = Number(left);
        right = Number(right);
      }

      const isNumeric = Number.isFinite(left) && Number.isFinite(right);

      switch (operator as ConditionOperator) {
        case "equals": return left == right;
        case "startswith": return String(left).startsWith(right);
        case "endswith": return String(left).endsWith(right);
        case "contains": return String(left).includes(right);

        case ">": return isNumeric && left > right;
        case ">=": return isNumeric && left >= right;
        case "<": return isNumeric && left < right;
        case "<=": return isNumeric && left <= right;
        default: return false;
      }
    };

    function tokenizeCondition(str: string): string[] {
      const tokens: string[] = [];
      let i = 0;
      let current = '';
      let depth = 0;

      while (i < str.length) {
        if (str[i] === '(') {
          depth++;
          current += str[i];
        } else if (str[i] === ')') {
          depth--;
          current += str[i];
        } else if (depth === 0) {
          const token = str.slice(i, i + 3).toLowerCase().trimEnd();
          if (token === 'and' && /\s/.test(str[i - 1] || '') && /\s/.test(str[i + 3] || '')) {
            if (current.trim()) tokens.push(current.trim());
            tokens.push(token);
            current = '';
            i += 2;
          } else if (token === 'or' && /\s/.test(str[i - 1] || '') && /\s/.test(str[i + 2] || '')) {
            if (current.trim()) tokens.push(current.trim());
            tokens.push(token);
            current = '';
            i += 1;
          } else current += str[i];
        } else current += str[i];
        i++;
      }

      if (current.trim()) tokens.push(current.trim());
      return tokens;
    }

    const evalLogical = (cond: string): boolean => {
      cond = cond.trim();

      if (cond.startsWith('(') && cond.endsWith(')')) {
        let depth = 0;
        let balanced = true;
        for (let i = 0; i < cond.length; i++) {
          if (cond[i] === '(') depth++;
          if (cond[i] === ')') depth--;
          if (depth === 0 && i < cond.length - 1) {
            balanced = false;
            break;
          }
        }

        if (balanced) return evalLogical(cond.slice(1, -1));
      }

      if (/^not\s+/i.test(cond)) return !evalLogical(cond.replace(/^not\s+/i, ''));

      const tokens = tokenizeCondition(cond);
      if (tokens.length === 1) return evalComparison(tokens[0]!);

      let result: boolean | undefined = undefined;
      let op: 'and' | 'or' | undefined = undefined;
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!;
        if (token === 'and' || token === 'or') op = token as 'and' | 'or';
        else {
          if (!result) result = evalLogical(token);
          else if (op === 'and' && result) {
            if (!result) return false;
            result = result && evalLogical(token);
          } else if (op === 'or') {
            if (result) return true;
            result = result || evalLogical(token);
          }
          op = void 0;
        }
      }

      return !!result;
    };

    let conditionResult = evalLogical(condition);

    return Utils.trimQuotes(this.#evaluateLogicBlock(`{{ ${(conditionResult ? trueBlock : falseBlock).trim()} }}`));
  }

  #evaluateLogicBlock(input: string): any {
    const trimmed = input.trim().split(/\r?\n/).map(e => e.trim()).join(' ');
    if (!trimmed.startsWith("{{") || !trimmed.endsWith("}}")) return input;
    const content = trimmed.slice(2, -2).trim();

    const nullish = this.#evaluateNullishCoalesce(content);
    if (nullish !== void 0) return Utils.trimQuotes(nullish);

    const ifElse = this.#evaluateIfElseLogic(content);
    if (ifElse !== void 0) return Utils.trimQuotes(ifElse);

    return content;
  }

  #resolveVariableChain(str: string, variable: ConfigVariableKey<ConfigType<K, V>>, chain: string[]): string {
    if (!variable) return str;
    const nextChain = [...chain, variable];
    if (chain.includes(variable)) {
      throw new Throwable('ReferenceError', `Circular dependency detected`, nextChain.join(' -> '));
    }

    if (!this.#bank.has(variable)) {
      this.#bank.set(variable, void 0);
      const configValue = this.#resolveVariable(`$${variable}`);
      if (configValue === void 0) return str;
      const formatted = this.#translateVariables(configValue, nextChain);
      this.#bank.set(variable, formatted);
    }

    const cached = this.#bank.get(variable);
    if (chain.length > 0) {
      let deps = this.#dependencies.get(variable) ?? new Set();
      chain.forEach(dep => deps.add(dep as ConfigVariableKey<ConfigType<K, V>>));
      this.#dependencies.set(variable, deps);
    }

    if (cached === void 0) return str;
    return cached as string;
  }

  #translateVariables(value: any, chain: string[] = []): any {
    if (typeof value === 'string') {
      const regex = /^\$([a-zA-Z_][a-zA-Z0-9_\.]*)$/;
      const fullMatch = value.match(regex);

      value = value.replace(/(\{\{[\s\S]+?\}\})/mg, (input: string) => this.#evaluateLogicBlock(input));

      if (fullMatch && !value.replace(fullMatch[0], '').trim().length) {
        return this.#resolveVariableChain(fullMatch[0], fullMatch[1] as any, chain);
      }

      value = value.replace(new RegExp(regex.source.slice(1, -1), 'g'), (str: string, variable: string) => this.#resolveVariableChain(str, variable as any, chain));
      return Utils.parsePrimitiveValue(value);
    } else if (Array.isArray(value)) {
      return value.map(val => this.#translateVariables(val, chain));
    }

    return Utils.parsePrimitiveValue(value);
  }

  get<S extends ConfigVariableKey<ConfigType<K, V>>[]>(...keys: S): PickConfigObject<ConfigType<K, V>, S> {
    const result: PickConfigObject<ConfigType<K, V>, S> = {} as any;

    for (const key of keys) {
      const parts = (key as string).split('.');
      const value = this.#translateVariables(this.#resolveConfigPath(key));

      if (value === void 0) continue;

      let current: any = result;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]!;
        if (!current[part]) current[part] = {};
        current = current[part];
      }

      current[parts[parts.length - 1]!] = value;
    }

    return result;
  }

  raw<S extends ConfigVariableKey<ConfigType<K, V>>[]>(...keys: S): PickConfigObject<ConfigType<K, V>, S> {
    const result: PickConfigObject<ConfigType<K, V>, S> = {} as any;

    for (const key of keys) {
      const parts = (key as string).split('.');
      const value = this.#resolveConfigPath(key);

      if (value === void 0) continue;

      let current: any = result;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]!;
        if (!current[part]) current[part] = {};
        current = current[part];
      }

      current[parts[parts.length - 1]!] = value;
    }

    return result;
  }

  hash(): string {
    return Bun.hash(JSON.stringify(this.#config, void 0, 2)).toString(16);
  }

  constructor(config: ConfigType<K, V>) {
    this.#config = Utils.ensureObject<Partial<ConfigType<K, V>>>(config, {});
  }
}
