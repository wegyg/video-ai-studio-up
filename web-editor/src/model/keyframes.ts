/**
 * 키프레임 (R16): 위치(x·y)·크기·회전·투명도·볼륨이 시간에 따라 바뀐다. 이징은 선형 / 부드럽게.
 * 미리보기·내보내기·속성 패널·소리가 모두 이 파일로 값을 구한다 (같은 계산 → 미리보기 = 내보내기).
 *
 * - 키의 시간 `f`는 클립 시작 기준 프레임이다 → 클립을 옮기면 키도 같이 움직인다.
 * - 앞을 자르거나 나눠도 키는 타임라인의 같은 순간에 남는다(오프셋을 옮긴다). 범위 밖 키도 지우지 않는다
 *   → 자른 경계에서도 값이 끊기지 않고 이어진다.
 * - 키가 있는 속성을 고치면(속성 패널·미리보기 끌기) 플레이헤드 위치의 키를 고치거나 새로 만든다.
 *   키가 없는 속성은 예전처럼 클립 값 자체를 고친다.
 * - `ease`는 그 키에서 다음 키까지 가는 방식이다.
 */
import type { Clip, Easing, Keyframe, Keyframes, KeyProp, Transform } from './types';

export const KEY_PROPS: KeyProp[] = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'];
export const TRANSFORM_PROPS: KeyProp[] = ['x', 'y', 'scale', 'rotation', 'opacity'];

const keysOf = (c: Pick<Clip, 'keyframes'>, p: KeyProp): Keyframe[] | undefined => {
  const k = c.keyframes?.[p];
  return k && k.length ? k : undefined;
};

export const hasKeys = (c: Pick<Clip, 'keyframes'>, p: KeyProp): boolean => !!keysOf(c, p);
export const hasAnyKeys = (c: Pick<Clip, 'keyframes'>): boolean => KEY_PROPS.some((p) => hasKeys(c, p));

/** 키가 없을 때의 값 (클립 자체 값) */
export function baseValue(c: Clip, p: KeyProp): number {
  if (p === 'volume') return c.type === 'text' ? 1 : c.volume;
  return c.transform[p];
}

const smooth = (u: number) => u * u * (3 - 2 * u);

/** 키 목록에서 클립 기준 시각 t(프레임, 소수 가능)의 값 */
export function sample(keys: readonly Keyframe[], t: number): number {
  const first = keys[0];
  if (t <= first.f) return first.v;
  const last = keys[keys.length - 1];
  if (t >= last.f) return last.v;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].f <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  let u = (t - a.f) / (b.f - a.f);
  if (a.ease === 'smooth') u = smooth(u);
  return a.v + (b.v - a.v) * u;
}

/** 타임라인 프레임 frame에서의 값 (키가 없으면 클립 값) */
export function valueAt(c: Clip, p: KeyProp, frame: number): number {
  const keys = keysOf(c, p);
  return keys ? sample(keys, frame - c.start) : baseValue(c, p);
}

/** 이 프레임의 화면 배치. 배치 키가 없으면 클립의 transform 그대로(같은 객체) */
export function transformAt(c: Clip, frame: number): Transform {
  if (!TRANSFORM_PROPS.some((p) => hasKeys(c, p))) return c.transform;
  return {
    x: valueAt(c, 'x', frame),
    y: valueAt(c, 'y', frame),
    scale: valueAt(c, 'scale', frame),
    rotation: valueAt(c, 'rotation', frame),
    opacity: valueAt(c, 'opacity', frame),
  };
}

/** 이 프레임의 값으로 배치를 바꾼 클립 (그리기용). 배치 키가 없으면 같은 객체 */
export function clipAtFrame<T extends Clip>(c: T, frame: number): T {
  const t = transformAt(c, frame);
  return t === c.transform ? c : { ...c, transform: t };
}

/** 클립이 가장 크게 보일 때의 크기 (내보내기 디코딩 해상도를 정할 때) */
export function maxScale(c: Clip): number {
  const keys = keysOf(c, 'scale');
  return keys ? Math.max(...keys.map((k) => k.v)) : c.transform.scale;
}

/** 키가 있는 클립 기준 프레임들 (모든 속성, 오름차순, 중복 없음) */
export function keyOffsets(c: Pick<Clip, 'keyframes'>): number[] {
  const set = new Set<number>();
  for (const p of KEY_PROPS) for (const k of keysOf(c, p) ?? []) set.add(k.f);
  return [...set].sort((a, b) => a - b);
}

/** 클립 기준 프레임 f에 키가 있는 속성들 */
export function propsKeyedAt(c: Pick<Clip, 'keyframes'>, f: number): KeyProp[] {
  return KEY_PROPS.filter((p) => keysOf(c, p)?.some((k) => k.f === f));
}

function withKeys<T extends Clip>(c: T, next: Keyframes): T {
  const clean: Keyframes = {};
  for (const p of KEY_PROPS) if (next[p]?.length) clean[p] = next[p];
  const out = { ...c };
  if (Object.keys(clean).length) out.keyframes = clean;
  else delete out.keyframes;
  return out;
}

function upsert(keys: readonly Keyframe[], f: number, v: number): Keyframe[] {
  const i = keys.findIndex((k) => k.f === f);
  if (i >= 0) return keys.map((k, j) => (j === i ? { ...k, v } : k));
  // 새 키의 이징은 바로 앞 키를 따른다 (없으면 선형)
  const prev = [...keys].reverse().find((k) => k.f < f);
  return [...keys, { f, v, ease: prev?.ease ?? 'linear' }].sort((a, b) => a.f - b.f);
}

/**
 * 값 바꾸기: 키가 있는 속성은 frame에 키를 넣거나 고치고, 키가 없는 속성은 클립 값을 고친다.
 * 바뀐 것이 없으면 같은 객체.
 */
export function setValues<T extends Clip>(c: T, frame: number, patch: Partial<Record<KeyProp, number>>): T {
  const f = Math.round(frame - c.start);
  let changed = false;
  const keys: Keyframes = { ...c.keyframes };
  const base: Partial<Transform> = {};
  let volume: number | undefined;
  for (const p of KEY_PROPS) {
    const v = patch[p];
    if (v === undefined) continue;
    if (hasKeys(c, p)) {
      const cur = keys[p]!.find((k) => k.f === f);
      if (cur?.v === v) continue;
      keys[p] = upsert(keys[p]!, f, v);
      changed = true;
    } else if (baseValue(c, p) !== v) {
      if (p === 'volume') volume = v;
      else base[p] = v;
      changed = true;
    }
  }
  if (!changed) return c;
  let out: T = { ...c, transform: { ...c.transform, ...base } };
  if (volume !== undefined && out.type !== 'text') out = { ...out, volume };
  return withKeys(out, keys);
}

/**
 * 키 넣기/빼기 (속성 패널의 ◆ 버튼). props가 모두 frame에 키가 있으면 지우고,
 * 아니면 없는 속성에 지금 보이는 값으로 키를 넣는다.
 */
export function toggleKeys<T extends Clip>(c: T, frame: number, props: KeyProp[]): T {
  const f = Math.round(frame - c.start);
  const all = props.every((p) => keysOf(c, p)?.some((k) => k.f === f));
  const keys: Keyframes = { ...c.keyframes };
  for (const p of props) {
    if (all) keys[p] = (keys[p] ?? []).filter((k) => k.f !== f);
    else if (!keysOf(c, p)?.some((k) => k.f === f)) keys[p] = upsert(keys[p] ?? [], f, valueAt(c, p, frame));
  }
  let out = withKeys(c, keys);
  // 마지막 키를 지우면 그 순간의 값을 클립 값으로 남긴다 (지웠다고 화면이 갑자기 바뀌지 않게)
  if (all) {
    const base: Partial<Transform> = {};
    for (const p of props) {
      if (hasKeys(out, p)) continue;
      const v = valueAt(c, p, frame);
      if (p === 'volume') {
        if (out.type !== 'text') out = { ...out, volume: v };
      } else base[p] = v;
    }
    if (Object.keys(base).length) out = { ...out, transform: { ...out.transform, ...base } };
  }
  return out;
}

/** 클립 기준 프레임 f에 있는 모든 키의 이징 */
export function setEaseAt<T extends Clip>(c: T, f: number, ease: Easing): T {
  let changed = false;
  const keys: Keyframes = { ...c.keyframes };
  for (const p of KEY_PROPS) {
    const list = keysOf(c, p);
    if (!list?.some((k) => k.f === f && k.ease !== ease)) continue;
    keys[p] = list.map((k) => (k.f === f ? { ...k, ease } : k));
    changed = true;
  }
  return changed ? withKeys(c, keys) : c;
}

/** 클립 기준 프레임 from의 키들(모든 속성)을 to로 옮긴다. to에 있던 같은 속성의 키는 대신한다 */
export function moveKeys<T extends Clip>(c: T, from: number, to: number): T {
  if (from === to) return c;
  const keys: Keyframes = { ...c.keyframes };
  let changed = false;
  for (const p of KEY_PROPS) {
    const list = keysOf(c, p);
    const k = list?.find((x) => x.f === from);
    if (!list || !k) continue;
    keys[p] = [...list.filter((x) => x.f !== from && x.f !== to), { ...k, f: to }].sort((a, b) => a.f - b.f);
    changed = true;
  }
  return changed ? withKeys(c, keys) : c;
}

/** 모든 키를 delta 프레임 옮긴 목록 (앞을 자르거나 나눌 때: 키가 타임라인의 같은 순간에 남도록) */
export function shiftKeyframes(k: Keyframes | undefined, delta: number): Keyframes | undefined {
  if (!k || delta === 0) return k;
  const out: Keyframes = {};
  for (const p of KEY_PROPS) if (k[p]?.length) out[p] = k[p]!.map((x) => ({ ...x, f: x.f + delta }));
  return out;
}
