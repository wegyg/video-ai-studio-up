/**
 * 모든 UI 문자열 (R2). 컴포넌트에는 문자열을 직접 쓰지 않고 여기서 가져온다.
 */
export const ko = {
  project: {
    defaultName: '제목 없는 프로젝트',
  },
  tracks: {
    text: '텍스트',
    video: (n: number) => `영상 ${n}`,
    audio: (n: number) => `오디오 ${n}`,
  },
  text: {
    defaultContent: '텍스트를 입력하세요',
  },
} as const;
