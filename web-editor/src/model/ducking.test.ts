import { describe, expect, it } from 'vitest';
import { DUCK_ATTACK, DUCK_RELEASE, duckEnvelope, duckFactor } from './ducking';
import * as ops from './ops';
import type { AssetMeta, EditState, MediaClip } from './types';

const names = { text: 'T', video: (n: number) => `V${n}`, audio: (n: number) => `A${n}` };
const meta = (id: string, kind: AssetMeta['kind']): AssetMeta => ({ id, kind, name: id, size: 1, mime: 'x', lastModified: 0, durationFrames: 300, hasAudio: true, hasProxy: false });
const assets = { bgm: meta('bgm', 'audio'), voice: meta('voice', 'audio'), vid: meta('vid', 'video') };
const loud = new Float32Array(1000).fill(0.5);

function project(voiceExtra: Partial<MediaClip> = {}, muted = false): { edit: EditState; bgm: MediaClip } {
  const e = ops.addTrack(ops.createEditState('9:16', names), 'audio', 'A2');
  const bgm: MediaClip = { ...ops.createMediaClip(assets.bgm, 0), id: 'bgm', duration: 300, duck: 0.3 };
  const voice: MediaClip = { ...ops.createMediaClip(assets.voice, 60), id: 'voice', duration: 60, ...voiceExtra };
  const tracks = e.tracks.map((t, i) => (i === 3 ? { ...t, clips: [bgm] } : i === 4 ? { ...t, muted, clips: [voice] } : t));
  return { edit: { ...e, tracks }, bgm };
}

describe('자동 덕킹 (R19)', () => {
  it('다른 소리가 나오기 조금 전부터 줄어 있고, 끝나면 천천히 돌아온다', () => {
    const { edit, bgm } = project();
    const env = duckEnvelope(edit, assets, () => loud, 300)!;
    expect(env[60 - DUCK_ATTACK - 1]).toBe(0);
    expect(env[59]).toBeCloseTo(1);
    expect(env[90]).toBe(1);
    expect(env[119]).toBe(1);
    expect(env[119 + DUCK_RELEASE]).toBeCloseTo(0);
    expect(env[119 + 5]).toBeCloseTo(1 - 5 / DUCK_RELEASE);
    expect(duckFactor(bgm, env, 90)).toBeCloseTo(0.3);
    expect(duckFactor(bgm, env, 20)).toBe(1);
    // 덕킹을 안 켠 클립은 영향이 없다
    expect(duckFactor({ ...bgm, duck: undefined }, env, 90)).toBe(1);
  });

  it('조용한 구간, 음소거 트랙, 소리를 분리한 영상은 덕킹을 일으키지 않는다', () => {
    const quiet = new Float32Array(1000).fill(0.01);
    expect(duckEnvelope(project().edit, assets, (id) => (id === 'voice' ? quiet : loud), 300)!.every((v) => v === 0)).toBe(true);
    expect(duckEnvelope(project({}, true).edit, assets, () => loud, 300)!.every((v) => v === 0)).toBe(true);
    const detached = project({ type: 'video', assetId: 'vid', audioDetached: true });
    expect(duckEnvelope(detached.edit, assets, () => loud, 300)!.every((v) => v === 0)).toBe(true);
  });

  it('덕킹할 클립이 없으면 계산하지 않는다', () => {
    const { edit } = project();
    const off = { ...edit, tracks: edit.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, duck: undefined })) })) };
    expect(duckEnvelope(off, assets, () => loud, 300)).toBeNull();
  });
});
