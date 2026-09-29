/**
 * R2.2: UI 문자열은 ko.ts 한 곳에만 둔다.
 * 모든 .tsx를 실제 파서(rolldown parseAst, Vite 8 내장)로 읽어 JSX 안에 직접 쓴 글자(한글/영문)를 찾는다.
 *  - JSX 텍스트:          <span>재생</span>
 *  - 문자열 속성:          title="재생" aria-label="Play" placeholder=… alt=… label=…
 *  - JSX 안 문자열 리터럴:  {'재생'}
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const HAS_WORD = /[A-Za-z가-힣]/;
const TEXT_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt', 'label']);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

type Node = { type?: string; [k: string]: unknown };

function findHardcoded(code: string): string[] {
  const found: string[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const node = n as Node;
    if (node.type === 'JSXText' && HAS_WORD.test(String(node.value))) found.push(`텍스트 "${String(node.value).trim()}"`);
    if (node.type === 'JSXAttribute') {
      const name = (node.name as { name?: string })?.name ?? '';
      const value = node.value as { type?: string; value?: unknown } | null;
      if (TEXT_ATTRS.has(name) && value?.type === 'Literal' && HAS_WORD.test(String(value.value))) found.push(`${name}="${String(value.value)}"`);
    }
    if (node.type === 'JSXExpressionContainer') {
      const e = node.expression as { type?: string; value?: unknown };
      if (e?.type === 'Literal' && typeof e.value === 'string' && HAS_WORD.test(e.value)) found.push(`{'${e.value}'}`);
    }
    for (const k in node) if (k !== 'parent') walk(node[k]);
  };
  walk(parseAst(code, { lang: 'tsx' }));
  return found;
}

describe('UI 문자열은 ko.ts에만 (R2.2)', () => {
  it('검사기가 하드코딩 문자열을 실제로 찾아낸다', () => {
    const sample = `export const A = () => <button title="Play" aria-label={k.a}>재생 {'정지'}<b>{k.b}</b></button>;`;
    expect(findHardcoded(sample)).toEqual(['title="Play"', '텍스트 "재생"', "{'정지'}"]);
  });

  const files = tsxFiles(SRC);
  it('검사할 .tsx 파일이 있다', () => expect(files.length).toBeGreaterThan(5));
  for (const f of files) {
    it(relative(SRC, f), () => expect(findHardcoded(readFileSync(f, 'utf8'))).toEqual([]));
  }
});
