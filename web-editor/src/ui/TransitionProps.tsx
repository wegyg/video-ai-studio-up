/** 속성 패널: 고른 트랜지션의 종류·길이·다시 보기·삭제 (R14) */
import { actions } from '../actions';
import { ko } from '../i18n/ko';
import { findClip } from '../model/ops';
import { maxTransitionFrames, TRANSITION_KINDS, TRANSITION_MIN, transitionInto } from '../model/transitions';
import { FPS, type TransitionKind } from '../model/types';
import { useProject } from '../store/project';
import { SelectField, SliderField } from './fields';

export function TransitionProps({ toClipId }: { toClipId: string }) {
  const edit = useProject((s) => s.edit);
  const assets = useProject((s) => s.assets);
  const loc = findClip(edit, toClipId);
  const w = loc ? transitionInto(loc.track, toClipId) : null;
  if (!loc || !w) return <p className="px-4 py-6 text-center text-sm leading-relaxed text-neutral-400">{ko.inspector.empty}</p>;
  const max = Math.max(TRANSITION_MIN, maxTransitionFrames(loc.track, toClipId));
  const name = (assetId: string) => assets[assetId]?.name ?? '';
  const options = TRANSITION_KINDS.map((k) => ({ value: k, label: ko.effects.transitions[k] ?? k }));
  return (
    <section className="flex flex-col gap-2 px-3 py-3" data-testid="transition-props">
      <div className="flex items-center justify-between text-xs text-neutral-400">
        <span className="font-bold text-neutral-200">{ko.inspector.transition.title}</span>
        <span className="max-w-40 truncate" data-testid="transition-between">
          {ko.inspector.transition.between(name(w.from.assetId), name(w.to.assetId))}
        </span>
      </div>
      <SelectField<TransitionKind>
        label={ko.inspector.transition.kind}
        testId="transition-kind"
        value={w.kind}
        options={options}
        onCommit={(k) => {
          actions.setTransitionKind(toClipId, k);
          actions.previewTransition(toClipId);
        }}
      />
      <SliderField
        label={ko.inspector.transition.duration}
        testId="transition-duration"
        value={w.duration}
        min={TRANSITION_MIN}
        max={max}
        step={0.1}
        digits={1}
        unit={ko.inspector.units.second}
        toView={(f) => f / FPS}
        fromView={(sec) => sec * FPS}
        onCommit={(f) => actions.setTransitionDuration(toClipId, f)}
      />
      <div className="mt-1 flex items-center justify-between">
        <button
          type="button"
          data-testid="transition-play"
          onClick={() => actions.previewTransition(toClipId)}
          className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700"
        >
          {ko.inspector.transition.play}
        </button>
        <button
          type="button"
          data-testid="transition-delete"
          onClick={() => actions.removeTransition(toClipId)}
          className="rounded-md px-3 py-1.5 text-xs text-red-300 hover:bg-red-950"
        >
          {ko.inspector.transition.remove}
        </button>
      </div>
    </section>
  );
}
