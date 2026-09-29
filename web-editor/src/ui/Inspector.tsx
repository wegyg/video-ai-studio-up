import { ko } from '../i18n/ko';

/** 우측 속성 패널 — 태스크 6에서 선택 클립 속성을 채운다 */
export function Inspector() {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-neutral-800 bg-neutral-900" data-testid="inspector">
      <h2 className="border-b border-neutral-800 px-3 py-2.5 text-sm font-bold">{ko.inspector.title}</h2>
      <p className="px-4 py-6 text-center text-sm leading-relaxed text-neutral-400">{ko.inspector.empty}</p>
    </aside>
  );
}
