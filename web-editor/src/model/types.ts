/**
 * 편집 데이터 모델. 시간은 모두 정수 프레임(30fps)으로 저장한다.
 * 실수 오차가 없고, 분할/스냅이 프레임에 정확히 맞는다. 화면 표시와 디코딩할 때만 초로 바꾼다.
 */
export const FPS = 30;

export type Ratio = '9:16' | '16:9' | '1:1';
export const RATIOS: Ratio[] = ['9:16', '16:9', '1:1'];
export const RATIO_SIZE: Record<Ratio, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
};

export type AssetKind = 'video' | 'image' | 'audio';

/** 가져온 미디어의 메타데이터. 원본 Blob은 IndexedDB(media 저장소)에 따로 둔다. */
export interface AssetMeta {
  id: string;
  kind: AssetKind;
  name: string;
  size: number;
  mime: string;
  lastModified: number;
  /** 영상/오디오 길이(프레임) */
  durationFrames?: number;
  /** 영상/이미지 표시 크기(회전 반영) */
  width?: number;
  height?: number;
  hasAudio: boolean;
  hasProxy: boolean;
}

export type TrackKind = 'video' | 'text' | 'audio';

/** 캔버스 중심 기준 위치(px), 배율, 회전(도), 투명도(0~1) */
export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface ClipBase {
  id: string;
  /** 타임라인 시작 프레임 */
  start: number;
  /** 길이(프레임), 1 이상 */
  duration: number;
}

export interface MediaClip extends ClipBase {
  type: 'video' | 'image' | 'audio';
  assetId: string;
  /** 원본에서의 시작 프레임 (이미지는 항상 0) */
  inPoint: number;
  /** 1 = 100% (0~2) */
  volume: number;
  /** 페이드 길이(프레임) */
  fadeIn: number;
  fadeOut: number;
  /** 1단계에서는 1배 고정 */
  speed: 1;
  /** 오디오 클립은 사용하지 않음 */
  transform: Transform;
}

export type TextFont = 'Pretendard' | 'Noto Sans KR';
export type TextWeight = 400 | 700 | 900;

export interface TextClip extends ClipBase {
  type: 'text';
  text: string;
  font: TextFont;
  /** 글자 크기(px, 프로젝트 해상도 기준) */
  size: number;
  weight: TextWeight;
  color: string;
  align: 'left' | 'center' | 'right';
  stroke: { color: string; width: number };
  box: { enabled: boolean; color: string; opacity: number; padding: number };
  transform: Transform;
}

export type Clip = MediaClip | TextClip;

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  /** 시작 프레임 순으로 정렬, 서로 겹치지 않음 */
  clips: Clip[];
}

/** 실행 취소 대상이 되는 편집 상태. tracks 배열 순서 = 타임라인 위→아래. */
export interface EditState {
  ratio: Ratio;
  tracks: Track[];
}
