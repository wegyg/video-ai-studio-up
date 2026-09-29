import { useEffect } from 'react';
import { hasFiles, importFiles } from '../media/import';
import { installShortcuts } from '../shortcuts';
import { Inspector } from './Inspector';
import { LeftPanel } from './LeftPanel';
import { Preview } from './Preview';
import { Timeline } from './timeline/Timeline';
import { Toasts } from './toasts';
import { TopBar } from './TopBar';

/**
 * 미디어 패널 밖에 파일을 떨어뜨리면 브라우저가 그 파일로 페이지를 이동해 편집 내용을 잃는다.
 * 그래서 창 전체에서 파일 놓기를 막고, 대신 가져온다.
 */
function useWindowFileDrop() {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (hasFiles(e.dataTransfer)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer) || e.defaultPrevented) return;
      e.preventDefault();
      void importFiles(Array.from(e.dataTransfer!.files));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
}

/** 캡컷형 배치: 위 메뉴 / 좌측 자료 · 중앙 미리보기 · 우측 속성 / 하단 타임라인 */
export function Editor() {
  useEffect(() => installShortcuts(), []);
  useWindowFileDrop();
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
      <Toasts />
    </div>
  );
}
