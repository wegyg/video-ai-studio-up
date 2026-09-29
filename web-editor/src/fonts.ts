/**
 * 앱에 포함한 한글 글꼴 (외부 CDN 없음). 미리보기(메인 스레드)와 내보내기(Worker)가
 * 같은 파일을 FontFace로 등록한다. URL은 Vite가 빌드 때 해시 경로로 바꿔 준다.
 */
import pretendard400 from './assets/fonts/Pretendard-Regular.woff2?url';
import pretendard700 from './assets/fonts/Pretendard-Bold.woff2?url';
import pretendard900 from './assets/fonts/Pretendard-Black.woff2?url';
import noto400 from './assets/fonts/NotoSansKR-Regular.woff2?url';
import noto700 from './assets/fonts/NotoSansKR-Bold.woff2?url';
import noto900 from './assets/fonts/NotoSansKR-Black.woff2?url';

export type FontFamily = 'Pretendard' | 'Noto Sans KR';
export type FontWeight = 400 | 700 | 900;

export const FONT_FAMILIES: FontFamily[] = ['Pretendard', 'Noto Sans KR'];
export const FONT_WEIGHTS: FontWeight[] = [400, 700, 900];

const URLS: Record<FontFamily, Record<FontWeight, string>> = {
  Pretendard: { 400: pretendard400, 700: pretendard700, 900: pretendard900 },
  'Noto Sans KR': { 400: noto400, 700: noto700, 900: noto900 },
};

/** 글꼴 파일 주소 (내보내기 Worker에 절대 주소로 넘길 때 쓴다) */
export function fontUrl(family: FontFamily, weight: FontWeight): string {
  return URLS[family][weight];
}

type FontSet = FontFaceSet & { add(font: FontFace): FontFaceSet };

const loaded = new Map<string, Promise<void>>();

/** 글꼴 하나를 등록하고 불러온다. 같은 글꼴은 한 번만 불러온다. */
export function ensureFont(family: FontFamily, weight: FontWeight, set: FontSet = document.fonts as FontSet): Promise<void> {
  const key = `${family}:${weight}`;
  let p = loaded.get(key);
  if (!p) {
    const face = new FontFace(family, `url(${URLS[family][weight]})`, { weight: String(weight), style: 'normal' });
    set.add(face);
    p = face.load().then(() => undefined);
    loaded.set(key, p);
  }
  return p;
}

/** UI에 쓰는 글꼴(Pretendard 400/700)을 미리 불러온다. */
export function loadUiFonts(): Promise<void> {
  return Promise.all([ensureFont('Pretendard', 400), ensureFont('Pretendard', 700)]).then(() => undefined);
}

/** 모든 글꼴 (내보내기, 테스트용). */
export function loadAllFonts(set?: FontSet): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const f of FONT_FAMILIES) for (const w of FONT_WEIGHTS) jobs.push(ensureFont(f, w, set));
  return Promise.all(jobs).then(() => undefined);
}
