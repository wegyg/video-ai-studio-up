import { describe, expect, it } from 'vitest';
import { previewColorSpace } from './color';

const REC601: VideoColorSpaceInit = { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false };
const REC709: VideoColorSpaceInit = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
// HDR 값은 브라우저가 돌려주지만 TypeScript DOM 타입에는 아직 없다
const HLG = { primaries: 'bt2020', transfer: 'hlg', matrix: 'bt2020-ncl', fullRange: false } as unknown as VideoColorSpaceInit;

describe('previewColorSpace (Chrome <video>와 같은 색 해석)', () => {
  it('색 정보가 없으면 세로 720 미만은 BT.601, 이상은 BT.709', () => {
    expect(previewColorSpace('avc', { fullRange: false }, 360)).toEqual(REC601);
    expect(previewColorSpace('avc', undefined, 719)).toEqual(REC601);
    expect(previewColorSpace('avc', {}, 720)).toEqual(REC709);
    expect(previewColorSpace('avc', {}, 1920)).toEqual(REC709);
  });

  it('일부만 있으면 통째로 해상도 기준 값으로 바꾼다 (Chrome은 셋 다 있어야 원본 값을 쓴다)', () => {
    expect(previewColorSpace('avc', { matrix: 'bt709', fullRange: false }, 360)).toEqual(REC601);
    expect(previewColorSpace('hevc', { primaries: 'smpte170m', transfer: 'smpte170m' }, 1080)).toEqual(REC709);
  });

  it('셋 다 적혀 있으면 원본 값을 그대로 둔다', () => {
    expect(previewColorSpace('avc', { ...REC709 }, 360)).toBeNull();
    expect(previewColorSpace('avc', { ...REC601 }, 1080)).toBeNull();
    expect(previewColorSpace('hevc', HLG, 1920)).toBeNull();
  });

  it('VP9·AV1은 Chrome도 추정하지 않으므로 건드리지 않는다', () => {
    expect(previewColorSpace('vp9', {}, 360)).toBeNull();
    expect(previewColorSpace('av1', undefined, 360)).toBeNull();
    expect(previewColorSpace('vp8', {}, 360)).toEqual(REC601);
  });
});
