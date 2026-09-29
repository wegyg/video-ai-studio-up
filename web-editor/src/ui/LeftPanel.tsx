import type { ReactNode } from 'react';
import { ko } from '../i18n/ko';
import { type LeftTab, useUI } from '../store/ui';
import { IconFilm, IconMusic, IconShapes, IconSparkles, IconType } from './icons';
import { ElementsPanel } from './ElementsPanel';
import { EffectsPanel } from './EffectsPanel';
import { MediaPanel } from './MediaPanel';
import { TextPanel } from './TextPanel';

const TABS: { id: LeftTab; label: string; icon: ReactNode }[] = [
  { id: 'media', label: ko.tabs.media, icon: <IconFilm /> },
  { id: 'text', label: ko.tabs.text, icon: <IconType /> },
  { id: 'audio', label: ko.tabs.audio, icon: <IconMusic /> },
  { id: 'elements', label: ko.tabs.elements, icon: <IconShapes /> },
  { id: 'effects', label: ko.tabs.effects, icon: <IconSparkles /> },
];

function TabContent({ tab }: { tab: LeftTab }) {
  switch (tab) {
    case 'media':
      return <MediaPanel />;
    case 'text':
      return <TextPanel />;
    case 'audio':
      return <MediaPanel audioOnly />;
    case 'effects':
      return <EffectsPanel />;
    case 'elements':
      return <ElementsPanel />;
  }
}

export function LeftPanel() {
  const tab = useUI((s) => s.leftTab);
  const setTab = useUI((s) => s.setLeftTab);
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900" data-testid="left-panel">
      <div role="tablist" aria-label={ko.tabs.label} className="flex border-b border-neutral-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="left-tabpanel"
            onClick={() => setTab(t.id)}
            className={
              'flex flex-1 flex-col items-center gap-1 py-2 text-xs ' +
              (tab === t.id ? 'text-cyan-300 shadow-[inset_0_-2px_0] shadow-cyan-400' : 'text-neutral-400 hover:text-neutral-200')
            }
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id="left-tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1 overflow-auto p-3">
        <TabContent tab={tab} />
      </div>
    </aside>
  );
}
