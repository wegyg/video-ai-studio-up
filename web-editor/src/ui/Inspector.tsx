/**
 * 우측 속성 패널 (R3.4). 선택한 클립의 값을 보여 주고 고친다.
 * 미리보기 핸들 조작과 같은 값을 읽고 쓰므로 양쪽이 항상 같은 값을 보여 준다.
 */
import { actions } from '../actions';
import { ko } from '../i18n/ko';
import { DEFAULT_TRANSFORM, findClip, isMedia } from '../model/ops';
import { FPS, type Clip, type MediaClip, type Transform } from '../model/types';
import { useProject } from '../store/project';
import { useUI } from '../store/ui';
import { NumberField, SliderField } from './fields';

const FADE_MAX = 5 * FPS;

/**
 * 선택한 클립과 그 트랙 종류.
 * zustand v5는 선택자 결과를 Object.is로 비교하므로 매번 새 객체를 만들면 무한 재렌더링이 된다.
 * 그래서 스토어 안의 클립 객체(참조가 그대로 유지됨)와 문자열을 따로 고른다.
 */
function useSelectedClip(): Clip | null {
  const id = useUI((s) => s.selectedClipId);
  return useProject((s) => (id ? (findClip(s.edit, id)?.clip ?? null) : null));
}

function useSelectedTrackKind(): string | null {
  const id = useUI((s) => s.selectedClipId);
  return useProject((s) => (id ? (findClip(s.edit, id)?.track.kind ?? null) : null));
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b border-neutral-800 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-bold text-neutral-300">{title}</h3>
        {action}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function TransformFields({ clip }: { clip: Clip }) {
  const t = clip.transform;
  const set = (patch: Partial<Transform>) =>
    useProject.getState().updateClip(clip.id, (c) => ({ ...c, transform: { ...c.transform, ...patch } }));
  return (
    <Section
      title={ko.inspector.sectionTransform}
      action={
        <button
          type="button"
          data-testid="reset-transform"
          onClick={() => set(DEFAULT_TRANSFORM)}
          className="text-xs text-neutral-400 underline hover:text-neutral-200"
        >
          {ko.inspector.reset}
        </button>
      }
    >
      <NumberField label={ko.inspector.x} testId="prop-x" value={t.x} min={-9999} max={9999} onCommit={(x) => set({ x })} />
      <NumberField label={ko.inspector.y} testId="prop-y" value={t.y} min={-9999} max={9999} onCommit={(y) => set({ y })} />
      <NumberField
        label={ko.inspector.scale}
        testId="prop-scale"
        value={t.scale}
        min={0.02}
        max={10}
        unit={ko.inspector.units.percent}
        toView={(v) => v * 100}
        fromView={(v) => v / 100}
        onCommit={(scale) => set({ scale })}
      />
      <NumberField
        label={ko.inspector.rotation}
        testId="prop-rotation"
        value={t.rotation}
        min={-180}
        max={180}
        unit={ko.inspector.units.degree}
        onCommit={(rotation) => set({ rotation })}
      />
      <SliderField
        label={ko.inspector.opacity}
        testId="prop-opacity"
        value={t.opacity}
        min={0}
        max={1}
        unit={ko.inspector.units.percent}
        toView={(v) => v * 100}
        fromView={(v) => v / 100}
        onCommit={(opacity) => set({ opacity })}
      />
    </Section>
  );
}

function AudioFields({ clip }: { clip: MediaClip }) {
  const hasAudio = useProject((s) => s.assets[clip.assetId]?.hasAudio ?? false);
  const set = (patch: Partial<MediaClip>) => useProject.getState().updateClip(clip.id, (c) => ({ ...c, ...patch }) as Clip);
  const maxFade = Math.min(FADE_MAX, clip.duration);
  return (
    <Section title={ko.inspector.sectionAudio}>
      {!hasAudio && <p className="text-xs text-neutral-500">{ko.inspector.noAudio}</p>}
      <SliderField
        label={ko.inspector.volume}
        testId="prop-volume"
        value={clip.volume}
        min={0}
        max={2}
        unit={ko.inspector.units.percent}
        toView={(v) => v * 100}
        fromView={(v) => v / 100}
        disabled={!hasAudio}
        onCommit={(volume) => set({ volume })}
      />
      <NumberField
        label={ko.inspector.fadeIn}
        testId="prop-fade-in"
        value={clip.fadeIn}
        min={0}
        max={maxFade}
        step={0.1}
        unit={ko.inspector.units.second}
        toView={(v) => v / FPS}
        fromView={(v) => Math.round(v * FPS)}
        disabled={!hasAudio}
        onCommit={(fadeIn) => set({ fadeIn })}
      />
      <NumberField
        label={ko.inspector.fadeOut}
        testId="prop-fade-out"
        value={clip.fadeOut}
        min={0}
        max={maxFade}
        step={0.1}
        unit={ko.inspector.units.second}
        toView={(v) => v / FPS}
        fromView={(v) => Math.round(v * FPS)}
        disabled={!hasAudio}
        onCommit={(fadeOut) => set({ fadeOut })}
      />
      <div className="flex items-center gap-2 text-xs">
        <span className="w-16 shrink-0 text-neutral-400">{ko.inspector.speed}</span>
        <span data-testid="prop-speed" className="tabular-nums text-neutral-300">
          {clip.speed}
          {ko.inspector.units.times}
        </span>
        <span className="text-[11px] text-neutral-500">{ko.inspector.speedLocked}</span>
      </div>
    </Section>
  );
}

export function Inspector() {
  const clip = useSelectedClip();
  const trackKind = useSelectedTrackKind();
  const playhead = useUI((s) => s.playhead);
  const visible = clip ? playhead >= clip.start && playhead < clip.start + clip.duration : false;

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-neutral-800 bg-neutral-900" data-testid="inspector">
      <h2 className="border-b border-neutral-800 px-3 py-2.5 text-sm font-bold">{ko.inspector.title}</h2>
      {!clip ? (
        <p className="px-4 py-6 text-center text-sm leading-relaxed text-neutral-400">{ko.inspector.empty}</p>
      ) : (
        <>
          <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-xs text-neutral-400">
            <span data-testid="prop-kind">{ko.inspector.kind[clip.type]}</span>
            {!visible && (
              <button
                type="button"
                data-testid="goto-clip"
                onClick={() => actions.seek(clip.start)}
                className="text-cyan-400 underline hover:text-cyan-300"
              >
                {ko.inspector.goToClip}
              </button>
            )}
          </div>
          {!visible && <p className="px-3 pt-2 text-xs text-neutral-500">{ko.inspector.offscreen}</p>}
          {trackKind !== 'audio' && <TransformFields clip={clip} />}
          {isMedia(clip) && <AudioFields clip={clip} />}
        </>
      )}
    </aside>
  );
}
