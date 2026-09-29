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

/**
 * 색 조정 값 (R15). 0이면 원본 그대로.
 * brightness·contrast·saturation·temperature: -100~100, sharpness·vignette: 0~100
 */
export interface ColorAdjust {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  sharpness: number;
  vignette: number;
}

/** 클립 필터: 고른 프리셋(없으면 null)과 실제 조정 값. 프리셋은 조정 값 모음일 뿐이라 고른 뒤에도 바꿀 수 있다 */
export interface ClipFilter {
  preset: string | null;
  adjust: ColorAdjust;
}

/**
 * 캔버스 배경 (R18). 클립이 캔버스를 다 덮지 못할 때 빈 곳을 무엇으로 채울지.
 * blur: 맨 아래 영상을 캔버스에 꽉 차게 키워 흐리게 깐다 (16:9 영상을 9:16에 넣을 때 위아래)
 */
export type CanvasBackground = { kind: 'color'; color: string } | { kind: 'blur'; amount: number };

export interface MediaClip extends ClipBase {
  type: 'video' | 'image' | 'audio';
  assetId: string;
  /** 필터·조정 (영상·이미지만). 없으면 원본 그대로 — 예전에 저장한 프로젝트에는 이 값이 없다 */
  filter?: ClipFilter;
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
export type TextAlign = 'left' | 'center' | 'right';

/** 등장·퇴장 애니메이션 종류 (R7.7). 슬라이드는 방향별로 하나씩. */
export type TextAnimType =
  | 'none'
  | 'fade'
  | 'pop'
  | 'typewriter'
  | 'slideUp'
  | 'slideDown'
  | 'slideLeft'
  | 'slideRight'
  | 'bounce'
  | 'zoom';

export interface TextAnim {
  type: TextAnimType;
  /** 길이(프레임) */
  duration: number;
}

export interface TextStroke {
  color: string;
  /** 두께(px, 프로젝트 해상도 기준). 0이면 없음 */
  width: number;
}

export interface TextBox {
  enabled: boolean;
  color: string;
  opacity: number;
  padding: number;
  radius: number;
}

export interface TextShadow {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

/** 프리셋으로 한 번에 바꾸는 서식 값 (R7.6) */
export interface TextStyle {
  font: TextFont;
  /** 글자 크기(px, 프로젝트 해상도 기준) */
  size: number;
  weight: TextWeight;
  color: string;
  align: TextAlign;
  /** 줄 간격 배수 */
  lineHeight: number;
  stroke: TextStroke;
  box: TextBox;
  shadow: TextShadow;
}

export interface TextClip extends ClipBase, TextStyle {
  type: 'text';
  text: string;
  animIn: TextAnim;
  animOut: TextAnim;
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
  /** 캔버스 배경. 없으면 검정 — 예전에 저장한 프로젝트에는 이 값이 없다 */
  background?: CanvasBackground;
}
