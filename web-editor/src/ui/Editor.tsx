import { useEffect } from 'react';
import { installShortcuts } from '../shortcuts';
import { Inspector } from './Inspector';
import { LeftPanel } from './LeftPanel';
import { Preview } from './Preview';
import { Timeline } from './timeline/Timeline';
import { TopBar } from './TopBar';

/** 캡컷형 배치: 위 메뉴 / 좌측 자료 · 중앙 미리보기 · 우측 속성 / 하단 타임라인 */
export function Editor() {
  useEffect(() => installShortcuts(), []);
  return (
    // grid-cols-1 = minmax(0,1fr): 열이 타임라인 내용 너비만큼 늘어나 화면 밖으로 밀리지 않게 한다
    <div className="grid h-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)_minmax(240px,40%)]">
      <TopBar />
      <div className="flex min-h-0">
        <LeftPanel />
        <Preview />
        <Inspector />
      </div>
      <Timeline />
    </div>
  );
}
