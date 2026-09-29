/** 좌측 "요소" 탭 (R18 오버레이): 도형 4종, 로고·화면 속 화면(사진·영상을 위 트랙에 작게 얹기) */
import { actions } from '../actions';
import { ko } from '../i18n/ko';
import type { ShapeKind } from '../model/types';
import { useProject } from '../store/project';
import { IconLayers } from './icons';

const SHAPES: ShapeKind[] = ['rect', 'rounded', 'circle', 'triangle'];

function ShapeIcon({ shape }: { shape: ShapeKind }) {
  const fill = '#22d3ee';
  return (
    <svg viewBox="0 0 40 28" className="h-full w-full" aria-hidden="true">
      {shape === 'rect' && <rect x="6" y="6" width="28" height="16" fill={fill} />}
      {shape === 'rounded' && <rect x="6" y="6" width="28" height="16" rx="5" fill={fill} />}
      {shape === 'circle' && <circle cx="20" cy="14" r="9" fill={fill} />}
      {shape === 'triangle' && <polygon points="20,4 30,24 10,24" fill={fill} />}
    </svg>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1 text-xs font-bold text-neutral-300">{title}</h3>
      <p className="mb-2 text-[11px] leading-relaxed text-neutral-500">{hint}</p>
      {children}
    </section>
  );
}

export function ElementsPanel() {
  const visuals = useProject((s) => s.assets);
  const list = Object.values(visuals).filter((a) => a.kind === 'image' || a.kind === 'video');
  return (
    <div data-testid="elements-panel">
      <Section title={ko.elements.shapes} hint={ko.elements.shapesHint}>
        <div className="grid grid-cols-2 gap-2">
          {SHAPES.map((s) => (
            <button
              key={s}
              type="button"
              data-testid="add-shape"
              data-shape={s}
              aria-label={ko.shapes[s]}
              title={ko.shapes[s]}
              onClick={() => actions.addShape(s)}
              className="flex flex-col overflow-hidden rounded-md bg-neutral-800 ring-1 ring-neutral-700/60 hover:ring-cyan-500"
            >
              <span className="block aspect-[10/7] w-full bg-black">
                <ShapeIcon shape={s} />
              </span>
              <span className="py-0.5 text-center text-[11px] text-neutral-300">{ko.shapes[s]}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title={ko.elements.overlay} hint={ko.elements.overlayHint}>
        {list.length === 0 ? (
          <p className="rounded-md bg-neutral-800 px-3 py-3 text-center text-xs text-neutral-400">{ko.elements.empty}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {list.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  data-testid="overlay-asset"
                  data-asset-id={a.id}
                  aria-label={ko.elements.addOverlay(a.name)}
                  title={ko.elements.addOverlay(a.name)}
                  onClick={() => actions.addAssetAsOverlay(a.id)}
                  className="flex w-full items-center gap-2 rounded-md bg-neutral-800 px-2 py-1.5 text-left text-xs text-neutral-200 hover:bg-neutral-700"
                >
                  <IconLayers className="size-4 shrink-0 text-fuchsia-400" />
                  <span className="truncate">{a.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
