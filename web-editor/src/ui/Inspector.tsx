/**
 * 우측 속성 패널 (R3.4). 선택한 클립의 값을 보여 주고 고친다.
 * 미리보기 핸들 조작과 같은 값을 읽고 쓰므로 양쪽이 항상 같은 값을 보여 준다.
 */
import { actions } from '../actions';
import { ko } from '../i18n/ko';
import { hasAnyKeys, hasKeys, propsKeyedAt, transformAt, valueAt } from '../model/keyframes';
import { findClip, isMedia } from '../model/ops';
import { FPS, type Clip, type Easing, type KeyProp, type MediaClip, type Transform } from '../model/types';
import { useProject } from '../store/project';
import { useUI } from '../store/ui';
import { NumberField, SelectField, SliderField } from './fields';
import { TransitionProps } from './TransitionProps';
import { TextProps } from './TextProps';

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

/** ◆ 키프레임 넣기/빼기 버튼. 플레이헤드에 그 속성들의 키가 모두 있으면 채운 ◆ */
function KeyButton({ clip, props, label, enabled }: { clip: Clip; props: KeyProp[]; label: string; enabled: boolean }) {
  const playhead = useUI((s) => s.playhead);
  const keyed = propsKeyedAt(clip, playhead - clip.start);
  const on = props.every((p) => keyed.includes(p));
  const text = ko.inspector.keyframe.toggle(label);
  return (
    <button
      type="button"
      data-testid={`key-${props.join('-')}`}
      aria-pressed={on}
      aria-label={text}
      title={text}
      disabled={!enabled}
      onClick={() => actions.toggleKeyframe(clip.id, props)}
      className={
        'flex size-6 shrink-0 items-center justify-center rounded text-sm disabled:opacity-30 ' +
        (on ? 'text-cyan-300' : props.some((p) => hasKeys(clip, p)) ? 'text-cyan-600 hover:text-cyan-300' : 'text-neutral-500 hover:text-neutral-200')
      }
    >
      {on ? '◆' : '◇'}
    </button>
  );
}

/** 필드 + ◆ 버튼 한 줄 */
function Keyed({ children, button }: { children: React.ReactNode; button?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">{children}</div>
      {button ?? <span className="size-6 shrink-0" />}
    </div>
  );
}

/** 키가 있는 클립: 플레이헤드의 키 이징, 이전/다음 키로 이동 */
function KeyTools({ clip }: { clip: Clip }) {
  const playhead = useUI((s) => s.playhead);
  if (!hasAnyKeys(clip)) return <p className="text-[11px] leading-relaxed text-neutral-500">{ko.inspector.keyframe.hint}</p>;
  const f = playhead - clip.start;
  const keyed = propsKeyedAt(clip, f);
  const ease: Easing = keyed.length ? (clip.keyframes![keyed[0]]!.find((k) => k.f === f)?.ease ?? 'linear') : 'linear';
  const btn = 'rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700';
  return (
    <div className="flex items-center gap-2">
      <button type="button" data-testid="key-prev" className={btn} title={ko.inspector.keyframe.prev} aria-label={ko.inspector.keyframe.prev} onClick={() => actions.jumpKeyframe(clip.id, -1)}>
        ◀◆
      </button>
      <button type="button" data-testid="key-next" className={btn} title={ko.inspector.keyframe.next} aria-label={ko.inspector.keyframe.next} onClick={() => actions.jumpKeyframe(clip.id, 1)}>
        ◆▶
      </button>
      {keyed.length > 0 && (
        <div className="min-w-0 flex-1">
          <SelectField<Easing>
            label={ko.inspector.keyframe.ease}
            testId="key-ease"
            value={ease}
            options={[
              { value: 'linear', label: ko.inspector.keyframe.linear },
              { value: 'smooth', label: ko.inspector.keyframe.smooth },
            ]}
            onCommit={(e) => actions.setKeyEase(clip.id, e)}
          />
        </div>
      )}
    </div>
  );
}

function TransformFields({ clip, visible }: { clip: Clip; visible: boolean }) {
  const playhead = useUI((s) => s.playhead);
  // 키프레임이 있으면 지금 플레이헤드에서 보이는 값을 보여 주고, 고치면 그 시각에 키를 넣는다
  const t = transformAt(clip, playhead);
  const set = (patch: Partial<Transform>) => actions.setValuesAt(clip.id, patch);
  const key = (props: KeyProp[], label: string) => <KeyButton clip={clip} props={props} label={label} enabled={visible} />;
  return (
    <Section
      title={ko.inspector.sectionTransform}
      action={
        <button
          type="button"
          data-testid="reset-transform"
          onClick={() => actions.resetTransform(clip.id)}
          className="text-xs text-neutral-400 underline hover:text-neutral-200"
        >
          {ko.inspector.reset}
        </button>
      }
    >
      <Keyed button={key(['x', 'y'], ko.inspector.keyframe.position)}>
        <NumberField label={ko.inspector.x} testId="prop-x" value={t.x} min={-9999} max={9999} onCommit={(x) => set({ x })} />
      </Keyed>
      <Keyed>
        <NumberField label={ko.inspector.y} testId="prop-y" value={t.y} min={-9999} max={9999} onCommit={(y) => set({ y })} />
      </Keyed>
      <Keyed button={key(['scale'], ko.inspector.scale)}>
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
      </Keyed>
      <Keyed button={key(['rotation'], ko.inspector.rotation)}>
        <NumberField
          label={ko.inspector.rotation}
          testId="prop-rotation"
          value={t.rotation}
          min={-180}
          max={180}
          unit={ko.inspector.units.degree}
          onCommit={(rotation) => set({ rotation })}
        />
      </Keyed>
      <Keyed button={key(['opacity'], ko.inspector.opacity)}>
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
      </Keyed>
      <KeyTools clip={clip} />
    </Section>
  );
}

function AudioFields({ clip, visible }: { clip: MediaClip; visible: boolean }) {
  const hasAudio = useProject((s) => s.assets[clip.assetId]?.hasAudio ?? false);
  const playhead = useUI((s) => s.playhead);
  const set = (patch: Partial<MediaClip>) => useProject.getState().updateClip(clip.id, (c) => ({ ...c, ...patch }) as Clip);
  const maxFade = Math.min(FADE_MAX, clip.duration);
  return (
    <Section title={ko.inspector.sectionAudio}>
      {!hasAudio && <p className="text-xs text-neutral-500">{ko.inspector.noAudio}</p>}
      <Keyed button={<KeyButton clip={clip} props={['volume']} label={ko.inspector.volume} enabled={visible && hasAudio} />}>
        <SliderField
          label={ko.inspector.volume}
          testId="prop-volume"
          value={valueAt(clip, 'volume', playhead)}
          min={0}
          max={2}
          unit={ko.inspector.units.percent}
          toView={(v) => v * 100}
          fromView={(v) => v / 100}
          disabled={!hasAudio}
          onCommit={(volume) => actions.setValuesAt(clip.id, { volume })}
        />
      </Keyed>
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
  const selectedTransition = useUI((s) => s.selectedTransition);
  const visible = clip ? playhead >= clip.start && playhead < clip.start + clip.duration : false;

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-neutral-800 bg-neutral-900" data-testid="inspector">
      <h2 className="border-b border-neutral-800 px-3 py-2.5 text-sm font-bold">{ko.inspector.title}</h2>
      {selectedTransition ? (
        <TransitionProps toClipId={selectedTransition} />
      ) : !clip ? (
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
          {trackKind !== 'audio' && <TransformFields clip={clip} visible={visible} />}
          {clip.type === 'text' && <TextProps clip={clip} />}
          {isMedia(clip) && <AudioFields clip={clip} visible={visible} />}
        </>
      )}
    </aside>
  );
}
