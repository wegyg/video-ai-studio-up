/**
 * 모든 UI 문자열 (R2). 컴포넌트에는 문자열을 직접 쓰지 않고 여기서 가져온다.
 * (src/i18n/no-hardcoded.test.ts가 컴포넌트의 하드코딩 문자열을 검사한다)
 */
export const ko = {
  app: {
    title: '웹 영상 편집기',
  },
  project: {
    defaultName: '제목 없는 프로젝트',
  },
  keys: {
    play: '스페이스바',
    split: 'S',
    delete: 'Delete',
    undo: 'Ctrl+Z',
    redo: 'Ctrl+Y',
    frame: '←/→',
  },
  topbar: {
    projectName: '프로젝트 이름',
    undo: '실행 취소',
    redo: '다시 실행',
  },
  tabs: {
    label: '자료 탭',
    media: '미디어',
    text: '텍스트',
    audio: '오디오',
    effects: '효과',
  },
  media: {
    empty: '영상, 이미지, 오디오 파일을 여기로 끌어다 놓거나 가져오기를 누르세요.',
    formats: '지원 형식: mp4, mov, jpg, png, mp3, wav',
  },
  textPanel: {
    pending: '텍스트 기능은 준비 중입니다.',
  },
  audioPanel: {
    pending: '오디오 기능은 준비 중입니다.',
  },
  effects: {
    phase2: '효과(트랜지션, 필터)는 2단계에서 제공 예정입니다.',
  },
  preview: {
    region: '미리보기',
    ratio: '화면 비율',
    play: '재생',
    pause: '일시 정지',
    currentTime: '현재 시간',
    totalTime: '전체 시간',
  },
  ratios: {
    '9:16': '세로 9:16',
    '16:9': '가로 16:9',
    '1:1': '정사각 1:1',
  },
  inspector: {
    title: '속성',
    empty: '타임라인에서 클립을 선택하면 속성이 여기에 표시됩니다.',
  },
  timeline: {
    region: '타임라인',
    split: '분할',
    delete: '삭제',
    snap: '자석',
    zoom: '줌',
    zoomIn: '확대',
    zoomOut: '축소',
    mute: '음소거',
    unmute: '음소거 해제',
    ruler: '시간 눈금',
  },
  tracks: {
    text: '텍스트',
    video: (n: number) => `영상 ${n}`,
    audio: (n: number) => `오디오 ${n}`,
  },
  text: {
    defaultContent: '텍스트를 입력하세요',
  },
  unsupported: {
    title: '이 환경에서는 편집기를 쓸 수 없습니다',
    insecure: '보안 연결(https)이나 localhost가 아닌 주소로 열려서 영상 처리 기능(WebCodecs)이 꺼져 있습니다.',
    noWebcodecs: '이 브라우저는 영상 처리 기능(WebCodecs)을 지원하지 않습니다.',
    howtoTitle: '해결 방법',
    howto: [
      'Windows에서는 최신 Chrome으로 여세요.',
      '배포된 https 주소로 접속하세요.',
      '내 컴퓨터에서 실행하려면 명령 프롬프트에서 npx serve dist를 실행한 뒤 Chrome으로 http://localhost:3000을 여세요.',
    ],
  },
} as const;

/** "라벨 (단축키)" 형식의 툴팁 */
export const withKey = (label: string, key: string): string => `${label} (${key})`;
