/**
 * 텍스트 스타일 프리셋 20종 (R7.6). 클릭하면 서식 값이 한 번에 바뀐다.
 * 프리셋은 "값 모음"일 뿐이라 적용한 뒤에도 개별 값을 고칠 수 있다.
 */
import type { TextStyle } from './types';

const noStroke = { color: '#000000', width: 0 };
const noBox = { enabled: false, color: '#000000', opacity: 0.6, padding: 24, radius: 12 };
const noShadow = { enabled: false, color: '#000000', blur: 0, offsetX: 0, offsetY: 0 };

export const TEXT_STYLE_BASE: TextStyle = {
  font: 'Pretendard',
  size: 96,
  weight: 700,
  color: '#ffffff',
  align: 'center',
  lineHeight: 1.25,
  stroke: { ...noStroke },
  box: { ...noBox },
  shadow: { ...noShadow },
};

export interface TextPreset {
  id: string;
  /** 목록에 보일 이름 */
  name: string;
  style: TextStyle;
}

const make = (id: string, name: string, patch: Partial<TextStyle>): TextPreset => ({
  id,
  name,
  style: {
    ...TEXT_STYLE_BASE,
    ...patch,
    stroke: { ...TEXT_STYLE_BASE.stroke, ...patch.stroke },
    box: { ...TEXT_STYLE_BASE.box, ...patch.box },
    shadow: { ...TEXT_STYLE_BASE.shadow, ...patch.shadow },
  },
});

export const TEXT_PRESETS: TextPreset[] = [
  // 기본형
  make('plain-white', '기본 흰색', {}),
  make('plain-black', '기본 검정', { color: '#111111' }),
  // 외곽선형
  make('outline-thin', '얇은 외곽선', { stroke: { color: '#000000', width: 6 } }),
  make('outline-bold', '굵은 외곽선', { weight: 900, stroke: { color: '#000000', width: 14 } }),
  make('outline-mint', '민트 외곽선', { color: '#ffffff', stroke: { color: '#14b8a6', width: 10 } }),
  make('outline-pink', '분홍 외곽선', { color: '#ffffff', weight: 900, stroke: { color: '#db2777', width: 12 } }),
  // 박스형
  make('box-dark', '검은 반투명 박스', { box: { enabled: true, color: '#000000', opacity: 0.55, padding: 28, radius: 14 } }),
  make('box-white', '흰 박스 검은 글씨', { color: '#111111', box: { enabled: true, color: '#ffffff', opacity: 0.92, padding: 28, radius: 14 } }),
  make('box-yellow', '노란 박스', { color: '#1a1a1a', weight: 900, box: { enabled: true, color: '#facc15', opacity: 1, padding: 26, radius: 10 } }),
  make('box-red', '빨간 박스', { box: { enabled: true, color: '#dc2626', opacity: 0.95, padding: 26, radius: 10 } }),
  make('box-blue', '파란 박스', { box: { enabled: true, color: '#2563eb', opacity: 0.95, padding: 26, radius: 10 } }),
  make('box-square', '각진 검은 박스', { box: { enabled: true, color: '#000000', opacity: 0.8, padding: 22, radius: 0 } }),
  // 그림자형
  make('shadow-soft', '부드러운 그림자', { shadow: { enabled: true, color: '#000000', blur: 24, offsetX: 0, offsetY: 8 } }),
  make('shadow-hard', '진한 그림자', { weight: 900, shadow: { enabled: true, color: '#000000', blur: 0, offsetX: 8, offsetY: 8 } }),
  make('shadow-yellow', '노란 글씨 그림자', { color: '#fde047', shadow: { enabled: true, color: '#000000', blur: 16, offsetX: 0, offsetY: 6 } }),
  // 네온형
  make('neon-cyan', '네온 하늘색', { color: '#ffffff', shadow: { enabled: true, color: '#22d3ee', blur: 40, offsetX: 0, offsetY: 0 } }),
  make('neon-pink', '네온 분홍', { color: '#ffffff', shadow: { enabled: true, color: '#f472b6', blur: 40, offsetX: 0, offsetY: 0 } }),
  make('neon-green', '네온 초록', { color: '#ecfccb', shadow: { enabled: true, color: '#4ade80', blur: 36, offsetX: 0, offsetY: 0 } }),
  // 쇼츠 자막형
  make('shorts-caption', '쇼츠 자막', {
    font: 'Noto Sans KR',
    size: 84,
    weight: 900,
    color: '#ffffff',
    stroke: { color: '#000000', width: 10 },
    shadow: { enabled: true, color: '#000000', blur: 12, offsetX: 0, offsetY: 4 },
  }),
  make('shorts-highlight', '쇼츠 강조', {
    font: 'Noto Sans KR',
    size: 104,
    weight: 900,
    color: '#fde047',
    stroke: { color: '#111111', width: 12 },
    shadow: { enabled: true, color: '#000000', blur: 18, offsetX: 0, offsetY: 6 },
  }),
];
