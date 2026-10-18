/**
 * Context-sensitive tokenizers for query.grammar.
 *
 * The hard part of the syntax is parentheses: `(foo bar)` groups, but `test()`, `(pr` and
 * `func(a)` are ordinary terms, and in regex mode `(a|b)` is a regex atom while `(file:a or b)`
 * still groups. These rules decide, from the raw input around the cursor, which one a `(` or `)`
 * is. They match Sourcebot's behaviour; parity/grammar/diff.mjs checks that against v6.
 */
import { ExternalTokenizer, type InputStream, type Stack } from "@lezer/lr";
import { closeParen, Dialect_regex, negate, openParen, or, word } from "./parser.terms";

const EOF = -1;
const LPAREN = 40; // (
const RPAREN = 41; // )
const QUOTE = 34; // "
const DASH = 45; // -
const COLON = 58; // :
const BACKSLASH = 92;
const NEWLINE = 10;

const FILTER_PREFIXES = [
  "archived:", "rev:", "content:", "c:", "context:", "file:", "f:", "fork:",
  "visibility:", "repo:", "r:", "lang:", "sym:", "reposet:",
];

const isSpace = (c: number) => c === 32 || c === 9 || c === NEWLINE;
const isIdentChar = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95;

const textAt = (input: InputStream, at: number, s: string) => {
  for (let i = 0; i < s.length; i++) if (input.peek(at + i) !== s.charCodeAt(i)) return false;
  return true;
};
const prefixAt = (input: InputStream, at: number) => FILTER_PREFIXES.some((p) => textAt(input, at, p));
const skipSpaces = (input: InputStream, at: number) => {
  while (isSpace(input.peek(at))) at++;
  return at;
};
const regexMode = (stack: Stack) => stack.dialectEnabled(Dialect_regex);

/** `or` is the operator only mid-query, as a whole word, with something after it. */
function orKeywordHere(input: InputStream): boolean {
  if (input.peek(0) !== 111 || input.peek(1) !== 114) return false; // "or"
  if (input.pos === 0) return false;
  const after = input.peek(2);
  if (after === EOF || isIdentChar(after)) return false;
  return input.peek(skipSpaces(input, 2)) !== EOF;
}

/** Offset of the `)` closing the `(` at `at`, skipping backslash escapes; null when unbalanced. */
function closingParen(input: InputStream, at: number): number | null {
  if (input.peek(at) !== LPAREN) return null;
  let depth = 1;
  for (let i = at + 1; ; i++) {
    const c = input.peek(i);
    if (c === EOF) return null;
    if (c === BACKSLASH) {
      i++;
      continue;
    }
    if (c === LPAREN) depth++;
    else if (c === RPAREN && --depth === 0) return i;
  }
}

/** True when the character at `at` is preceded by an odd run of backslashes. */
function escapedAt(input: InputStream, at: number): boolean {
  let n = 0;
  while (input.peek(at - 1 - n) === BACKSLASH) n++;
  return n % 2 === 1;
}

/** Offset of the `(` opened for the `)` under the cursor, scanning backwards; null if none. */
function openingParen(input: InputStream): number | null {
  if (input.next !== RPAREN) return null;
  let depth = 1;
  for (let i = -1; ; i--) {
    const c = input.peek(i);
    if (c === EOF) return null;
    if (escapedAt(input, i)) continue;
    if (c === RPAREN) depth++;
    else if (c === LPAREN && --depth === 0) return i;
  }
}

/**
 * Regex mode: does the balanced group at `at` read as query syntax? Yes when it is empty, holds
 * several top-level tokens, or its single token is a filter, a quoted string, or (recursively) a
 * nested or negated group that groups. A lone regex like `(foo|bar)` is not grouping.
 */
function regexGroupAt(input: InputStream, at: number): boolean {
  const close = closingParen(input, at);
  if (close === null) return false;
  let i = skipSpaces(input, at + 1);
  if (i >= close) return true;

  const tokens: [number, number][] = [];
  while (i < close) {
    const start = i;
    let depth = 0;
    let quoted = false;
    while (i < close) {
      const c = input.peek(i);
      if (c === BACKSLASH) {
        i += 2;
        continue;
      }
      if (quoted) {
        i++;
        if (c === QUOTE) quoted = false;
        continue;
      }
      if (c === QUOTE) {
        quoted = true;
        i++;
        continue;
      }
      if (c === LPAREN) {
        depth++;
        i++;
        continue;
      }
      if (c === RPAREN) {
        if (depth === 0) break;
        depth--;
        i++;
        continue;
      }
      if (depth === 0 && isSpace(c)) break;
      i++;
    }
    tokens.push([start, i]);
    i = skipSpaces(input, i);
  }
  if (tokens.length !== 1) return true;

  const [start, end] = tokens[0]!;
  const first = input.peek(start);
  if (prefixAt(input, start) || first === QUOTE) return true;
  if (first === DASH) {
    const next = skipSpaces(input, start + 1);
    if (prefixAt(input, next)) return true;
    return input.peek(next) === LPAREN && next < end ? regexGroupAt(input, next) : false;
  }
  return first === LPAREN && start < end ? regexGroupAt(input, start) : false;
}

/** A `(` can start a group only at a token boundary: input start, whitespace, `-` or `:`. */
const groupBoundary = (c: number) => c === EOF || isSpace(c) || c === DASH || c === COLON;

/**
 * Normal mode, backwards scan (bounded to 1000 chars): is there an unclosed `(` that opened a
 * group? A `(` glued to a word (`test(`) does not count, except `((` whose outer paren is at a
 * boundary.
 */
function insideOpenGroup(input: InputStream): boolean {
  let depth = 0;
  for (let i = -1; i >= -1000; i--) {
    const c = input.peek(i);
    if (c === EOF) return depth < 0;
    if (input.peek(i - 1) === BACKSLASH && input.peek(i - 2) !== BACKSLASH) continue;
    if (c === RPAREN) depth++;
    else if (c === LPAREN) {
      const before = input.peek(i - 1);
      const starts = groupBoundary(before) || (before === LPAREN && groupBoundary(input.peek(i - 2)));
      if (starts && --depth < 0) return true;
    }
  }
  return false;
}

const closesGroup = (input: InputStream, stack: Stack) => stack.canShift(closeParen) || insideOpenGroup(input);

export const openParenTok = new ExternalTokenizer((input, stack) => {
  if (input.next !== LPAREN) return;
  if (regexMode(stack) && !regexGroupAt(input, 0)) return;
  if (closingParen(input, 0) === null) return; // unbalanced: part of a word
  input.advance();
  input.acceptToken(openParen);
});

export const closeParenTok = new ExternalTokenizer((input, stack) => {
  if (input.next !== RPAREN) return;
  if (regexMode(stack)) {
    const open = openingParen(input);
    if (open === null || !regexGroupAt(input, open)) return;
  } else if (!closesGroup(input, stack)) {
    return;
  }
  input.advance();
  input.acceptToken(closeParen);
});

export const orTok = new ExternalTokenizer((input) => {
  if (!orKeywordHere(input)) return;
  input.advance(2);
  input.acceptToken(or);
});

/** `-` negates only a following filter or a balanced (in regex mode: grouping) parenthesis. */
export const negateTok = new ExternalTokenizer((input, stack) => {
  if (input.next !== DASH) return;
  const at = skipSpaces(input, 1);
  const group =
    input.peek(at) === LPAREN && closingParen(input, at) !== null && (!regexMode(stack) || regexGroupAt(input, at));
  if (!group && !prefixAt(input, at)) return;
  input.advance();
  input.acceptToken(negate);
});

/** A run of non-space characters that is not a quoted string, `or`, a filter keyword or a group paren. */
export const wordTok = new ExternalTokenizer((input, stack) => {
  if (input.next === EOF || isSpace(input.next)) return;

  if (input.next === QUOTE) {
    // A closed quote is the grammar's `quoted` token; an unclosed one is an ordinary word.
    for (let i = 1; ; i++) {
      const c = input.peek(i);
      if (c === EOF || c === NEWLINE) break;
      if (c === QUOTE) return;
      if (c === BACKSLASH) i++;
    }
  }
  if (orKeywordHere(input) || prefixAt(input, 0)) return;

  const start = input.pos;
  if (regexMode(stack)) {
    while (input.next !== EOF && !isSpace(input.next)) {
      if (input.next === RPAREN) {
        const open = openingParen(input);
        if (open !== null && regexGroupAt(input, open)) break;
      }
      input.advance();
    }
  } else if (input.next === LPAREN && closingParen(input, 0) !== null) {
    // A balanced `(` right after a filter keyword is a value like file:(test|spec); anywhere else it groups.
    let back = -1;
    while (isSpace(input.peek(back))) back--;
    if (input.peek(back) !== COLON) return;
    let depth = 0;
    while ((input.next as number) !== EOF && !isSpace(input.next)) {
      if (input.next === LPAREN) depth++;
      else if (input.next === RPAREN) {
        if (depth === 0) break; // closes an enclosing group
        depth--;
      }
      input.advance();
    }
  } else {
    while (input.next !== EOF && !isSpace(input.next)) {
      if (input.next === RPAREN && closesGroup(input, stack)) break;
      input.advance();
    }
  }
  if (input.pos > start) input.acceptToken(word);
});
