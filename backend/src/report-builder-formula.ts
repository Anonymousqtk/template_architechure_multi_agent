export type FormulaValueType = 'number' | 'string' | 'boolean' | 'date';

export type FormulaNode =
  | { kind: 'literal'; valueType: FormulaValueType; value: string | number | boolean }
  | { kind: 'field'; fieldId: string }
  | { kind: 'unary'; op: '-' | 'NOT'; operand: FormulaNode }
  | {
      kind: 'binary';
      op: '+' | '-' | '*' | '/' | '%' | '=' | '!=' | '<' | '<=' | '>' | '>=' | 'AND' | 'OR';
      left: FormulaNode;
      right: FormulaNode;
    }
  | { kind: 'call'; name: string; args: FormulaNode[] };

type Token =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'boolean'; value: boolean }
  | { type: 'field'; value: string }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: string }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'comma' };

const MAX_FORMULA_LENGTH = 1000;
const MAX_AST_DEPTH = 25;

const SUPPORTED_FUNCTIONS: Record<
  string,
  { minArgs: number; maxArgs: number; returnType: FormulaValueType | 'first_branch' }
> = {
  IF: { minArgs: 3, maxArgs: 3, returnType: 'first_branch' },
  COALESCE: { minArgs: 2, maxArgs: 6, returnType: 'first_branch' },
  ROUND: { minArgs: 1, maxArgs: 2, returnType: 'number' },
  ABS: { minArgs: 1, maxArgs: 1, returnType: 'number' },
  CEIL: { minArgs: 1, maxArgs: 1, returnType: 'number' },
  FLOOR: { minArgs: 1, maxArgs: 1, returnType: 'number' },
  MIN: { minArgs: 2, maxArgs: 10, returnType: 'number' },
  MAX: { minArgs: 2, maxArgs: 10, returnType: 'number' },
  SAFE_DIV: { minArgs: 2, maxArgs: 3, returnType: 'number' },
  CONCAT: { minArgs: 1, maxArgs: 10, returnType: 'string' },
  UPPER: { minArgs: 1, maxArgs: 1, returnType: 'string' },
  LOWER: { minArgs: 1, maxArgs: 1, returnType: 'string' },
  LEN: { minArgs: 1, maxArgs: 1, returnType: 'number' },
  DAYS_BETWEEN: { minArgs: 2, maxArgs: 2, returnType: 'number' },
  YEAR: { minArgs: 1, maxArgs: 1, returnType: 'number' },
  MONTH: { minArgs: 1, maxArgs: 1, returnType: 'number' },
};

export class FormulaError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FormulaError';
  }
}

function tokenize(expression: string): Token[] {
  const input = expression.trim();
  if (!input) throw new FormulaError('EMPTY_FORMULA', 'Formula cannot be empty.');
  if (input.length > MAX_FORMULA_LENGTH) {
    throw new FormulaError('FORMULA_TOO_LONG', 'Formula exceeds 1000 characters.');
  }

  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i++;
      continue;
    }

    if (ch === ',') {
      tokens.push({ type: 'comma' });
      i++;
      continue;
    }

    // Field reference: [entity.field_name]
    if (ch === '[') {
      const end = input.indexOf(']', i + 1);
      if (end === -1) {
        throw new FormulaError('UNCLOSED_FIELD_REF', 'Missing closing "]" in field reference.');
      }
      const fieldId = input.slice(i + 1, end).trim();
      if (!/^[a-zA-Z0-9_.-]+$/.test(fieldId)) {
        throw new FormulaError('INVALID_FIELD_REF', `Invalid field reference: [${fieldId}]`);
      }
      tokens.push({ type: 'field', value: fieldId });
      i = end + 1;
      continue;
    }

    // String literal: "..." or '...'
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let str = '';
      i++;
      let closed = false;
      while (i < input.length) {
        if (input[i] === '\\' && i + 1 < input.length) {
          str += input[i + 1];
          i += 2;
        } else if (input[i] === quote) {
          closed = true;
          i++;
          break;
        } else {
          str += input[i];
          i++;
        }
      }
      if (!closed) {
        throw new FormulaError('UNCLOSED_STRING', 'Unclosed string literal.');
      }
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // Number literal
    if (/[0-9]/.test(ch)) {
      let numStr = '';
      let hasDot = false;
      while (i < input.length && (/[0-9]/.test(input[i]) || (!hasDot && input[i] === '.'))) {
        if (input[i] === '.') hasDot = true;
        numStr += input[i];
        i++;
      }
      const value = Number(numStr);
      if (!Number.isFinite(value)) {
        throw new FormulaError('INVALID_NUMBER', `Invalid number: ${numStr}`);
      }
      tokens.push({ type: 'number', value });
      continue;
    }

    // Multi-char operators
    const twoChar = input.slice(i, i + 2);
    if (['!=', '<>', '<=', '>=', '=='].includes(twoChar)) {
      tokens.push({
        type: 'op',
        value: twoChar === '<>' ? '!=' : twoChar === '==' ? '=' : twoChar,
      });
      i += 2;
      continue;
    }

    if ('+-*/%<>=!'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }

    // Identifiers & keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
        ident += input[i];
        i++;
      }
      const upper = ident.toUpperCase();
      if (upper === 'TRUE') tokens.push({ type: 'boolean', value: true });
      else if (upper === 'FALSE') tokens.push({ type: 'boolean', value: false });
      else if (upper === 'AND' || upper === 'OR' || upper === 'NOT') {
        tokens.push({ type: 'op', value: upper });
      } else {
        tokens.push({ type: 'ident', value: upper });
      }
      continue;
    }

    throw new FormulaError('UNEXPECTED_TOKEN', `Unexpected character "${ch}" at position ${i}.`);
  }

  return tokens;
}

class FormulaParser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): FormulaNode {
    const node = this.parseOr(0);
    if (this.pos < this.tokens.length) {
      throw new FormulaError('UNEXPECTED_TRAILING_TOKEN', 'Unexpected trailing expression tokens.');
    }
    return node;
  }

  private guardDepth(depth: number) {
    if (depth > MAX_AST_DEPTH) {
      throw new FormulaError('FORMULA_TOO_COMPLEX', 'Formula nesting exceeds maximum depth.');
    }
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    const tok = this.tokens[this.pos];
    this.pos++;
    return tok;
  }

  private parseOr(depth: number): FormulaNode {
    this.guardDepth(depth);
    let left = this.parseAnd(depth);
    while (true) {
      const tok = this.peek();
      if (tok?.type !== 'op' || tok.value !== 'OR') break;
      this.consume();
      const right = this.parseAnd(depth);
      left = { kind: 'binary', op: 'OR', left, right };
    }
    return left;
  }

  private parseAnd(depth: number): FormulaNode {
    this.guardDepth(depth);
    let left = this.parseComparison(depth);
    while (true) {
      const tok = this.peek();
      if (tok?.type !== 'op' || tok.value !== 'AND') break;
      this.consume();
      const right = this.parseComparison(depth);
      left = { kind: 'binary', op: 'AND', left, right };
    }
    return left;
  }

  private parseComparison(depth: number): FormulaNode {
    this.guardDepth(depth);
    let left = this.parseAdditive(depth);
    const tok = this.peek();
    if (tok?.type === 'op' && ['=', '!=', '<', '<=', '>', '>='].includes(tok.value)) {
      const op = tok.value as '=' | '!=' | '<' | '<=' | '>' | '>=';
      this.consume();
      const right = this.parseAdditive(depth);
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseAdditive(depth: number): FormulaNode {
    this.guardDepth(depth);
    let left = this.parseMultiplicative(depth);
    while (true) {
      const tok = this.peek();
      if (tok?.type !== 'op' || (tok.value !== '+' && tok.value !== '-')) break;
      const op = tok.value as '+' | '-';
      this.consume();
      const right = this.parseMultiplicative(depth);
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseMultiplicative(depth: number): FormulaNode {
    this.guardDepth(depth);
    let left = this.parseUnary(depth);
    while (true) {
      const tok = this.peek();
      if (tok?.type !== 'op' || !['*', '/', '%'].includes(tok.value)) break;
      const op = tok.value as '*' | '/' | '%';
      this.consume();
      const right = this.parseUnary(depth);
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(depth: number): FormulaNode {
    this.guardDepth(depth);
    const tok = this.peek();
    if (tok?.type === 'op' && (tok.value === '-' || tok.value === 'NOT' || tok.value === '!')) {
      const rawOp = tok.value;
      this.consume();
      const op = rawOp === '-' ? '-' : 'NOT';
      return { kind: 'unary', op, operand: this.parseUnary(depth + 1) };
    }
    return this.parsePrimary(depth);
  }

  private parsePrimary(depth: number): FormulaNode {
    this.guardDepth(depth);
    const tok = this.peek();
    if (!tok) {
      throw new FormulaError('UNEXPECTED_EOF', 'Unexpected end of formula.');
    }

    if (tok.type === 'number') {
      this.consume();
      return { kind: 'literal', valueType: 'number', value: tok.value };
    }
    if (tok.type === 'string') {
      this.consume();
      return { kind: 'literal', valueType: 'string', value: tok.value };
    }
    if (tok.type === 'boolean') {
      this.consume();
      return { kind: 'literal', valueType: 'boolean', value: tok.value };
    }
    if (tok.type === 'field') {
      this.consume();
      return { kind: 'field', fieldId: tok.value };
    }

    if (tok.type === 'paren' && tok.value === '(') {
      this.consume();
      const inner = this.parseOr(depth + 1);
      const close = this.peek();
      if (close?.type !== 'paren' || close.value !== ')') {
        throw new FormulaError('MISSING_PAREN', 'Expected closing ")".');
      }
      this.consume();
      return inner;
    }

    if (tok.type === 'ident') {
      const fnName = tok.value;
      this.consume();
      const spec = SUPPORTED_FUNCTIONS[fnName];
      if (!spec) {
        throw new FormulaError('UNSUPPORTED_FUNCTION', `Unsupported function: ${fnName}`);
      }
      const open = this.peek();
      if (open?.type !== 'paren' || open.value !== '(') {
        throw new FormulaError('EXPECTED_CALL_ARGS', `Function ${fnName} requires parentheses ().`);
      }
      this.consume();

      const args: FormulaNode[] = [];
      const afterOpen = this.peek();
      if (afterOpen?.type !== 'paren' || afterOpen.value !== ')') {
        while (true) {
          args.push(this.parseOr(depth + 1));
          if (this.peek()?.type === 'comma') {
            this.consume();
          } else {
            break;
          }
        }
      }

      const close = this.peek();
      if (close?.type !== 'paren' || close.value !== ')') {
        throw new FormulaError('MISSING_PAREN', `Expected ")" after ${fnName} arguments.`);
      }
      this.consume();

      if (args.length < spec.minArgs || args.length > spec.maxArgs) {
        throw new FormulaError(
          'INVALID_ARG_COUNT',
          `Function ${fnName} expects between ${spec.minArgs} and ${spec.maxArgs} arguments.`,
        );
      }
      return { kind: 'call', name: fnName, args };
    }

    throw new FormulaError('UNEXPECTED_TOKEN', 'Unexpected token in formula.');
  }
}

export interface FormulaValidationResult {
  valid: boolean;
  resultType: FormulaValueType;
  referencedFields: string[];
  ast: FormulaNode;
}

function inferNodeType(
  node: FormulaNode,
  fieldTypes: Map<string, FormulaValueType>,
  referenced: Set<string>,
): FormulaValueType {
  switch (node.kind) {
    case 'literal':
      return node.valueType;
    case 'field': {
      const fieldType = fieldTypes.get(node.fieldId);
      if (!fieldType) {
        throw new FormulaError(
          'UNAUTHORIZED_OR_UNKNOWN_FIELD',
          `Field [${node.fieldId}] is not available or not authorized.`,
        );
      }
      referenced.add(node.fieldId);
      return fieldType;
    }
    case 'unary': {
      const inner = inferNodeType(node.operand, fieldTypes, referenced);
      if (node.op === '-') {
        if (inner !== 'number') {
          throw new FormulaError('TYPE_MISMATCH', 'Unary "-" requires a numeric operand.');
        }
        return 'number';
      }
      return 'boolean';
    }
    case 'binary': {
      const leftType = inferNodeType(node.left, fieldTypes, referenced);
      const rightType = inferNodeType(node.right, fieldTypes, referenced);
      if (['=', '!=', '<', '<=', '>', '>=', 'AND', 'OR'].includes(node.op)) {
        return 'boolean';
      }
      if (node.op === '+' && (leftType === 'string' || rightType === 'string')) {
        return 'string';
      }
      if (leftType !== 'number' || rightType !== 'number') {
        throw new FormulaError('TYPE_MISMATCH', `Operator "${node.op}" requires numeric operands.`);
      }
      return 'number';
    }
    case 'call': {
      const argTypes = node.args.map((arg) => inferNodeType(arg, fieldTypes, referenced));
      const spec = SUPPORTED_FUNCTIONS[node.name];
      if (!spec) {
        throw new FormulaError('UNSUPPORTED_FUNCTION', `Unsupported function: ${node.name}`);
      }
      if (spec.returnType === 'first_branch') {
        return node.name === 'IF' ? argTypes[1] : argTypes[0];
      }
      return spec.returnType;
    }
  }
}

export function validateFormulaExpression(
  expression: string,
  fieldTypes: Map<string, FormulaValueType>,
): FormulaValidationResult {
  const tokens = tokenize(expression);
  const ast = new FormulaParser(tokens).parse();
  const referenced = new Set<string>();
  const resultType = inferNodeType(ast, fieldTypes, referenced);
  return {
    valid: true,
    resultType,
    referencedFields: [...referenced],
    ast,
  };
}

function toNum(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBool(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') return val.length > 0 && val.toLowerCase() !== 'false';
  return Boolean(val);
}

function toDateMs(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const ms = Date.parse(String(val));
  return Number.isFinite(ms) ? ms : null;
}

export function evaluateFormulaAst(
  node: FormulaNode,
  rowValues: Record<string, unknown>,
): string | number | boolean | null {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'field': {
      const val = rowValues[node.fieldId];
      if (val === undefined) return null;
      if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') {
        return val;
      }
      return val === null ? null : String(val);
    }
    case 'unary': {
      const val = evaluateFormulaAst(node.operand, rowValues);
      if (node.op === 'NOT') return !toBool(val);
      const num = toNum(val);
      return num === null ? null : -num;
    }
    case 'binary': {
      if (node.op === 'AND') {
        return (
          toBool(evaluateFormulaAst(node.left, rowValues)) &&
          toBool(evaluateFormulaAst(node.right, rowValues))
        );
      }
      if (node.op === 'OR') {
        return (
          toBool(evaluateFormulaAst(node.left, rowValues)) ||
          toBool(evaluateFormulaAst(node.right, rowValues))
        );
      }
      const left = evaluateFormulaAst(node.left, rowValues);
      const right = evaluateFormulaAst(node.right, rowValues);

      if (node.op === '=') return left === right;
      if (node.op === '!=') return left !== right;

      if (node.op === '+' && (typeof left === 'string' || typeof right === 'string')) {
        return `${left ?? ''}${right ?? ''}`;
      }

      if (['<', '<=', '>', '>='].includes(node.op)) {
        const lNum = toNum(left);
        const rNum = toNum(right);
        const lVal = lNum ?? (typeof left === 'string' ? left : null);
        const rVal = rNum ?? (typeof right === 'string' ? right : null);
        if (lVal === null || rVal === null) return false;
        if (node.op === '<') return lVal < rVal;
        if (node.op === '<=') return lVal <= rVal;
        if (node.op === '>') return lVal > rVal;
        return lVal >= rVal;
      }

      const lNum = toNum(left) ?? 0;
      const rNum = toNum(right) ?? 0;
      if (node.op === '+') return lNum + rNum;
      if (node.op === '-') return lNum - rNum;
      if (node.op === '*') return lNum * rNum;
      if (node.op === '/') return rNum === 0 ? null : lNum / rNum;
      if (node.op === '%') return rNum === 0 ? null : lNum % rNum;
      return null;
    }
    case 'call': {
      const args = node.args;
      switch (node.name) {
        case 'IF': {
          const cond = evaluateFormulaAst(args[0], rowValues);
          return toBool(cond)
            ? evaluateFormulaAst(args[1], rowValues)
            : evaluateFormulaAst(args[2], rowValues);
        }
        case 'COALESCE': {
          for (const arg of args) {
            const val = evaluateFormulaAst(arg, rowValues);
            if (val !== null && val !== undefined && val !== '') return val;
          }
          return null;
        }
        case 'ROUND': {
          const n = toNum(evaluateFormulaAst(args[0], rowValues));
          const digits = args[1]
            ? Math.max(
                0,
                Math.min(6, Math.trunc(toNum(evaluateFormulaAst(args[1], rowValues)) ?? 0)),
              )
            : 0;
          if (n === null) return null;
          const factor = 10 ** digits;
          return Math.round(n * factor) / factor;
        }
        case 'ABS': {
          const n = toNum(evaluateFormulaAst(args[0], rowValues));
          return n === null ? null : Math.abs(n);
        }
        case 'CEIL': {
          const n = toNum(evaluateFormulaAst(args[0], rowValues));
          return n === null ? null : Math.ceil(n);
        }
        case 'FLOOR': {
          const n = toNum(evaluateFormulaAst(args[0], rowValues));
          return n === null ? null : Math.floor(n);
        }
        case 'MIN': {
          const nums = args
            .map((a) => toNum(evaluateFormulaAst(a, rowValues)))
            .filter((n): n is number => n !== null);
          return nums.length ? Math.min(...nums) : null;
        }
        case 'MAX': {
          const nums = args
            .map((a) => toNum(evaluateFormulaAst(a, rowValues)))
            .filter((n): n is number => n !== null);
          return nums.length ? Math.max(...nums) : null;
        }
        case 'SAFE_DIV': {
          const num = toNum(evaluateFormulaAst(args[0], rowValues));
          const den = toNum(evaluateFormulaAst(args[1], rowValues));
          const fallback = args[2] ? toNum(evaluateFormulaAst(args[2], rowValues)) : 0;
          if (num === null || den === null || den === 0) return fallback;
          return num / den;
        }
        case 'CONCAT':
          return args.map((a) => String(evaluateFormulaAst(a, rowValues) ?? '')).join('');
        case 'UPPER':
          return String(evaluateFormulaAst(args[0], rowValues) ?? '').toUpperCase();
        case 'LOWER':
          return String(evaluateFormulaAst(args[0], rowValues) ?? '').toLowerCase();
        case 'LEN':
          return String(evaluateFormulaAst(args[0], rowValues) ?? '').length;
        case 'DAYS_BETWEEN': {
          const d1 = toDateMs(evaluateFormulaAst(args[0], rowValues));
          const d2 = toDateMs(evaluateFormulaAst(args[1], rowValues));
          if (d1 === null || d2 === null) return null;
          return Math.round((d2 - d1) / 86_400_000);
        }
        case 'YEAR': {
          const d = toDateMs(evaluateFormulaAst(args[0], rowValues));
          return d === null ? null : new Date(d).getUTCFullYear();
        }
        case 'MONTH': {
          const d = toDateMs(evaluateFormulaAst(args[0], rowValues));
          return d === null ? null : new Date(d).getUTCMonth() + 1;
        }
        default:
          return null;
      }
    }
  }
}
