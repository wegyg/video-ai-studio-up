/** 인라인 SVG 아이콘 (외부 아이콘 라이브러리 없이) */
import type { ReactNode } from 'react';

type P = { className?: string };

function Svg({ className, children, fill = false }: P & { children: ReactNode; fill?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? 'size-4'}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconPlay = (p: P) => (
  <Svg {...p} fill>
    <path d="M8 5v14l11-7z" />
  </Svg>
);
export const IconPause = (p: P) => (
  <Svg {...p} fill>
    <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
  </Svg>
);
export const IconUndo = (p: P) => (
  <Svg {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
  </Svg>
);
export const IconRedo = (p: P) => (
  <Svg {...p}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9a5 5 0 0 0 0 10h3" />
  </Svg>
);
export const IconScissors = (p: P) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
  </Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
  </Svg>
);
export const IconMagnet = (p: P) => (
  <Svg {...p}>
    <path d="M6 15V9a6 6 0 0 1 12 0v6a3 3 0 0 1-3 3h0a3 3 0 0 1-3-3V9M6 15a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3" />
    <path d="M6 11h3M15 11h3" />
  </Svg>
);
export const IconZoomIn = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4M11 8v6M8 11h6" />
  </Svg>
);
export const IconZoomOut = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4M8 11h6" />
  </Svg>
);
export const IconVolume = (p: P) => (
  <Svg {...p}>
    <path d="M11 5 6 9H2v6h4l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
  </Svg>
);
export const IconVolumeOff = (p: P) => (
  <Svg {...p}>
    <path d="M11 5 6 9H2v6h4l5 4z" />
    <path d="m22 9-6 6M16 9l6 6" />
  </Svg>
);
export const IconFilm = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4" />
  </Svg>
);
export const IconType = (p: P) => (
  <Svg {...p}>
    <path d="M4 7V4h16v3M9 20h6M12 4v16" />
  </Svg>
);
export const IconMusic = (p: P) => (
  <Svg {...p}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </Svg>
);
export const IconSparkles = (p: P) => (
  <Svg {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </Svg>
);
/** 트랜지션: 두 장면이 겹치며 바뀜 */
export const IconTransition = (p: P) => (
  <Svg {...p}>
    <path d="M4 6h9v12H4zM11 6h9v12h-9" />
  </Svg>
);
/** 요소(도형): 네모와 동그라미 */
export const IconShapes = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="10" width="11" height="11" rx="1" />
    <circle cx="16" cy="8" r="5" />
  </Svg>
);
/** 위에 얹기: 겹친 두 장 */
export const IconLayers = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="7" width="13" height="13" rx="1.5" />
    <rect x="8" y="3" width="13" height="13" rx="1.5" />
  </Svg>
);
/** 자막: 말풍선 안의 글줄 */
export const IconCaptions = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M7 11h4M13 11h4M7 15h7" />
  </Svg>
);
export const IconUpload = (p: P) => (
  <Svg {...p}>
    <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconImage = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-5-5L5 21" />
  </Svg>
);


export const IconFrame = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M4 7.5h16M4 16.5h16" strokeDasharray="3 2" />
  </Svg>
);


export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />
  </Svg>
);

export const IconFolderOpen = (p: P) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1H3z" />
    <path d="M3 10h18l-2 9H5z" />
  </Svg>
);
