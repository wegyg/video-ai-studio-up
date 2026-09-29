/**
 * 좌측 "효과" 탭: 캔버스 배경(단색·흐림 채우기), 트랜지션 11종, 필터 프리셋 12종 + 조정 슬라이더 6종 (R14, R15, R18).
 * 필터 목록 썸네일은 선택한 클립의 포스터에 **실제와 같은 WebGL 셰이더**를 적용해 만든다 → 고르기 전에 결과가 보인다 (G1).
 */
import { useEffect, useRef, useState } from 'react';
import { actions } from '../actions';
import { effectsSupported, sharedEffects } from '../engine/gl/effects';
import { ko } from '../i18n/ko';
import { useMedia } from '../media/store';
import { ADJUST_KEYS, ADJUST_RANGE, DEFAULT_BACKGROUND, DEFAULT_BLUR_AMOUNT, FILTER_PRESETS, NEUTRAL_ADJUST } from '../model/filters';
import { findClip, isMedia } from '../model/ops';
import { TRANSITION_KINDS } from '../model/transitions';
import { VIDEO_EFFECTS } from '../model/effects';
import type { ColorAdjust, MediaClip, TransitionKind, VideoEffectKind } from '../model/types';
import { useProject } from '../store/project';
import { useUI } from '../store/ui';
import { ColorField, SliderField } from './fields';
import { TRANSITION_DRAG_TYPE, useTimelineView } from './timeline/view';

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1 text-xs font-bold text-neutral-300">{title}</h3>
      {hint && <p className="mb-2 text-[11px] leading-relaxed text-neutral-500">{hint}</p>}
      {children}
    </section>
  );
}

function BackgroundSection() {
  const bg = useProject((s) => s.edit.background ?? DEFAULT_BACKGROUND);
  const set = useProject((s) => s.setBackground);
  const blurAmount = bg.kind === 'blur' ? bg.amount : DEFAULT_BLUR_AMOUNT;
  const color = bg.kind === 'color' ? bg.color : DEFAULT_BACKGROUND.kind === 'color' ? DEFAULT_BACKGROUND.color : '#000000';
  const btn = (on: boolean) =>
    'flex-1 rounded-md px-2 py-1.5 text-xs ' + (on ? 'bg-cyan-600 font-bold text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700');
  return (
    <Section title={ko.effects.sectionBackground} hint={ko.effects.backgroundHint}>
      <div className="mb-2 flex gap-2" role="radiogroup" aria-label={ko.effects.sectionBackground}>
        <button type="button" role="radio" aria-checked={bg.kind === 'color'} data-testid="bg-color" className={btn(bg.kind === 'color')} onClick={() => set({ kind: 'color', color })}>
          {ko.effects.bgColor}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={bg.kind === 'blur'}
          data-testid="bg-blur"
          className={btn(bg.kind === 'blur')}
          onClick={() => set({ kind: 'blur', amount: blurAmount })}
        >
          {ko.effects.bgBlur}
        </button>
      </div>
      {bg.kind === 'color' ? (
        <ColorField label={ko.effects.bgColor} testId="bg-color-value" value={bg.color} onCommit={(c) => set({ kind: 'color', color: c })} />
      ) : (
        <SliderField
          label={ko.effects.blurAmount}
          testId="bg-blur-amount"
          min={0}
          max={100}
          value={bg.amount}
          onCommit={(v) => set({ kind: 'blur', amount: v })}
        />
      )}
    </Section>
  );
}

/** 선택한 영상·이미지 클립 (없으면 null) */
function useSelectedVisual(): MediaClip | null {
  const id = useUI((s) => s.selectedClipId);
  return useProject((s) => {
    const c = id ? findClip(s.edit, id)?.clip : null;
    return c && (c.type === 'video' || c.type === 'image') ? c : null;
  });
}

/** 프리셋별 썸네일: 클립 포스터에 같은 셰이더를 적용해 그린다 */
function usePresetThumbs(assetId: string | null): Record<string, string> {
  const posterUrl = useMedia((s) => (assetId ? s.entries[assetId]?.posterUrl : undefined));
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    if (!posterUrl) {
      setThumbs({});
      return;
    }
    (async () => {
      const blob = await (await fetch(posterUrl)).blob();
      const bmp = await createImageBitmap(blob);
      const fx = sharedEffects();
      const W = 96;
      const H = Math.max(1, Math.round((W * bmp.height) / bmp.width));
      const out: Record<string, string> = {};
      const c = new OffscreenCanvas(W, H);
      const ctx = c.getContext('2d')!;
      const all: [string, ColorAdjust][] = [['none', NEUTRAL_ADJUST], ...FILTER_PRESETS.map((p) => [p.id, p.adjust] as [string, ColorAdjust])];
      for (const [id, adjust] of all) {
        ctx.clearRect(0, 0, W, H);
        const r = id === 'none' || !fx ? null : fx.filter(bmp, adjust, W, H, W / bmp.width);
        if (r) ctx.drawImage(r.image, r.sx, r.sy, r.sw, r.sh, 0, 0, W, H);
        else ctx.drawImage(bmp, 0, 0, W, H);
        out[id] = URL.createObjectURL(await c.convertToBlob({ type: 'image/webp', quality: 0.8 }));
        if (cancelled) {
          for (const u of Object.values(out)) URL.revokeObjectURL(u);
          bmp.close();
          return;
        }
      }
      bmp.close();
      if (!cancelled) setThumbs(out);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [posterUrl]);
  // 썸네일 주소 정리
  const prev = useRef<Record<string, string>>({});
  useEffect(() => {
    const old = prev.current;
    prev.current = thumbs;
    for (const [k, u] of Object.entries(old)) if (thumbs[k] !== u) URL.revokeObjectURL(u);
  }, [thumbs]);
  return thumbs;
}

function FilterSection() {
  const clip = useSelectedVisual();
  const thumbs = usePresetThumbs(clip?.assetId ?? null);
  if (!clip) {
    return (
      <Section title={ko.effects.sectionFilter}>
        <p className="rounded-md bg-neutral-800 px-3 py-4 text-center text-xs leading-relaxed text-neutral-400" data-testid="filter-hint">
          {ko.effects.filterHint}
        </p>
      </Section>
    );
  }
  const current = clip.filter?.preset ?? null;
  const adjust = clip.filter?.adjust ?? NEUTRAL_ADJUST;
  const tile = (id: string | null, label: string) => {
    const key = id ?? 'none';
    const on = current === id;
    return (
      <button
        key={key}
        type="button"
        data-testid="filter-preset"
        data-preset-id={key}
        aria-pressed={on}
        aria-label={label}
        title={label}
        onClick={() => actions.applyFilterPreset(id)}
        className={'flex flex-col overflow-hidden rounded-md bg-neutral-800 ring-1 ' + (on ? 'ring-2 ring-cyan-400' : 'ring-neutral-700/60 hover:ring-cyan-500')}
      >
        <span className="flex aspect-square items-center justify-center overflow-hidden bg-black">
          {thumbs[key] && <img src={thumbs[key]} alt="" draggable={false} className="h-full w-full object-cover" />}
        </span>
        <span className="truncate px-1 py-0.5 text-center text-[10px] text-neutral-300">{label}</span>
      </button>
    );
  };
  return (
    <>
      <Section title={ko.effects.sectionFilter}>
        <div className="grid grid-cols-3 gap-2" data-testid="filter-presets">
          {tile(null, ko.effects.filterNone)}
          {FILTER_PRESETS.map((p) => tile(p.id, ko.effects.presets[p.id] ?? p.id))}
        </div>
      </Section>
      <Section title={ko.effects.sectionAdjust}>
        <div className="flex flex-col gap-2">
          {ADJUST_KEYS.map((k) => (
            <SliderField
              key={k}
              label={ko.effects.adjust[k]}
              testId={`adjust-${k}`}
              min={ADJUST_RANGE[k][0]}
              max={ADJUST_RANGE[k][1]}
              value={adjust[k]}
              onCommit={(v) => actions.setAdjust(k, v)}
            />
          ))}
          <button
            type="button"
            data-testid="adjust-reset"
            onClick={() => actions.applyFilterPreset(null)}
            className="self-end text-xs text-neutral-400 underline hover:text-neutral-200"
          >
            {ko.effects.resetAdjust}
          </button>
        </div>
      </Section>
    </>
  );
}

/** 트랜지션 아이콘: 앞 화면(회색)과 새 화면(청록)이 어떻게 바뀌는지 그림으로 */
function TransitionIcon({ kind }: { kind: TransitionKind }) {
  const A = '#737373';
  const B = '#22d3ee';
  const box = (children: React.ReactNode) => (
    <svg viewBox="0 0 40 28" className="h-full w-full" aria-hidden="true">
      <rect x="0" y="0" width="40" height="28" fill={A} />
      {children}
    </svg>
  );
  switch (kind) {
    case 'dissolve':
      return box(<rect x="0" y="0" width="40" height="28" fill={B} opacity="0.5" />);
    case 'slide-left':
      return box(<rect x="20" y="0" width="20" height="28" fill={B} />);
    case 'slide-right':
      return box(<rect x="0" y="0" width="20" height="28" fill={B} />);
    case 'slide-up':
      return box(<rect x="0" y="14" width="40" height="14" fill={B} />);
    case 'slide-down':
      return box(<rect x="0" y="0" width="40" height="14" fill={B} />);
    case 'zoom-in':
      return box(<rect x="12" y="8" width="16" height="12" fill={B} />);
    case 'zoom-out':
      return (
        <svg viewBox="0 0 40 28" className="h-full w-full" aria-hidden="true">
          <rect x="0" y="0" width="40" height="28" fill={B} />
          <rect x="12" y="8" width="16" height="12" fill={A} />
        </svg>
      );
    case 'wipe':
      return box(<polygon points="0,0 24,0 16,28 0,28" fill={B} />);
    case 'blur':
      return box(
        <>
          <rect x="0" y="0" width="40" height="28" fill={B} opacity="0.35" />
          <circle cx="20" cy="14" r="8" fill={B} opacity="0.6" />
        </>,
      );
    case 'shake':
      return box(<rect x="8" y="4" width="26" height="20" fill={B} transform="rotate(-8 20 14)" />);
    case 'glitch':
      return box(
        <>
          <rect x="4" y="3" width="36" height="5" fill={B} />
          <rect x="0" y="11" width="30" height="5" fill={B} />
          <rect x="8" y="19" width="32" height="5" fill={B} />
        </>,
      );
  }
}

/** 트랜지션 11종: 누르면 고른 클립(또는 플레이헤드 가까운) 경계에 넣고, 끌면 타임라인 경계에 놓는다 */
function TransitionSection() {
  const selected = useUI((s) => s.selectedTransition);
  const currentKind = useProject((s) => {
    const c = selected ? findClip(s.edit, selected)?.clip : null;
    return c && isMedia(c) ? (c.transitionIn?.kind ?? null) : null;
  });
  return (
    <Section title={ko.effects.sectionTransition} hint={ko.effects.transitionHint}>
      <div className="grid grid-cols-3 gap-2" data-testid="transition-presets">
        {TRANSITION_KINDS.map((k) => {
          const label = ko.effects.transitions[k] ?? k;
          const on = currentKind === k;
          return (
            <button
              key={k}
              type="button"
              draggable
              data-testid="transition-preset"
              data-kind={k}
              aria-pressed={on}
              aria-label={label}
              title={label}
              onClick={() => actions.applyTransition(k)}
              onDragStart={(e) => {
                e.dataTransfer.setData(TRANSITION_DRAG_TYPE, k);
                e.dataTransfer.effectAllowed = 'copy';
                useTimelineView.getState().set({ transitionDrag: k });
              }}
              onDragEnd={() => useTimelineView.getState().set({ transitionDrag: null })}
              className={
                'flex cursor-grab flex-col overflow-hidden rounded-md bg-neutral-800 ring-1 ' +
                (on ? 'ring-2 ring-cyan-400' : 'ring-neutral-700/60 hover:ring-cyan-500')
              }
            >
              <span className="block aspect-[10/7] w-full overflow-hidden bg-black">
                <TransitionIcon kind={k} />
              </span>
              <span className="truncate px-1 py-0.5 text-center text-[10px] text-neutral-300">{label}</span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

/** 영상 효과 아이콘 */
function FxIcon({ kind }: { kind: VideoEffectKind }) {
  const c = '#22d3ee';
  return (
    <svg viewBox="0 0 40 28" className="h-full w-full" aria-hidden="true">
      <rect x="0" y="0" width="40" height="28" fill="#404040" />
      {kind === 'shake' && (
        <>
          <rect x="9" y="6" width="22" height="16" fill="none" stroke="#737373" strokeWidth="1.5" />
          <rect x="12" y="4" width="22" height="16" fill="none" stroke={c} strokeWidth="2" />
        </>
      )}
      {kind === 'flash' && <polygon points="22,3 11,16 19,16 16,25 29,11 21,11" fill="#fde047" />}
      {kind === 'zoom-pulse' && (
        <>
          <rect x="13" y="9" width="14" height="10" fill={c} />
          <rect x="7" y="5" width="26" height="18" fill="none" stroke={c} strokeWidth="1.5" strokeDasharray="3 2" />
        </>
      )}
      {kind === 'mono' && (
        <>
          <rect x="0" y="0" width="20" height="28" fill="#d4d4d4" />
          <rect x="20" y="0" width="20" height="28" fill="#262626" />
        </>
      )}
      {kind === 'retro' && <rect x="4" y="4" width="32" height="20" rx="3" fill="#b08850" />}
      {kind === 'blur' && (
        <>
          <circle cx="20" cy="14" r="9" fill={c} opacity="0.35" />
          <circle cx="20" cy="14" r="5" fill={c} opacity="0.6" />
        </>
      )}
    </svg>
  );
}

/** 영상 효과 6종: 고른 클립에 켜고 끄기 + 켠 효과의 강도 */
function VideoFxSection() {
  const clip = useSelectedVisual();
  if (!clip) {
    return (
      <Section title={ko.effects.sectionVideoFx}>
        <p className="rounded-md bg-neutral-800 px-3 py-3 text-center text-xs leading-relaxed text-neutral-400">{ko.effects.filterHint}</p>
      </Section>
    );
  }
  return (
    <Section title={ko.effects.sectionVideoFx} hint={ko.effects.videoFxHint}>
      <div className="mb-2 grid grid-cols-3 gap-2" data-testid="video-fx-list">
        {VIDEO_EFFECTS.map((k) => {
          const on = !!clip.effects?.some((e) => e.kind === k);
          const label = ko.effects.videoFx[k] ?? k;
          return (
            <button
              key={k}
              type="button"
              data-testid="video-fx"
              data-kind={k}
              aria-pressed={on}
              aria-label={label}
              title={label}
              onClick={() => actions.toggleVideoEffect(k)}
              className={'flex flex-col overflow-hidden rounded-md bg-neutral-800 ring-1 ' + (on ? 'ring-2 ring-cyan-400' : 'ring-neutral-700/60 hover:ring-cyan-500')}
            >
              <span className="block aspect-[10/7] w-full">
                <FxIcon kind={k} />
              </span>
              <span className="truncate px-1 py-0.5 text-center text-[10px] text-neutral-300">{label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-col gap-2">
        {clip.effects?.map((e) => (
          <SliderField
            key={e.kind}
            label={ko.effects.videoFx[e.kind] ?? e.kind}
            testId={`fx-intensity-${e.kind}`}
            value={e.intensity}
            min={0}
            max={100}
            onCommit={(v) => actions.setVideoEffectIntensity(e.kind, v)}
          />
        ))}
      </div>
    </Section>
  );
}

export function EffectsPanel() {
  if (!effectsSupported()) {
    return (
      <p className="rounded-md bg-neutral-800 px-3 py-4 text-xs leading-relaxed text-neutral-400" data-testid="effects-unsupported">
        {ko.effects.unsupported}
      </p>
    );
  }
  return (
    <div data-testid="effects-panel">
      <BackgroundSection />
      <TransitionSection />
      <VideoFxSection />
      <FilterSection />
    </div>
  );
}
