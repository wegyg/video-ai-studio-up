import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react';
import { actions } from '../../actions';
import { ko, withKey } from '../../i18n/ko';
import { trackKindFor } from '../../model/ops';
import { snapCandidates, snapValue, SNAP_THRESHOLD_PX } from '../../model/snap';
import { editDuration } from '../../model/time';
import { cutsOf, nearestCut, transitionsOf } from '../../model/transitions';
import type { Track, TransitionKind } from '../../model/types';
import { useProject } from '../../store/project';
import { clampZoom, useUI } from '../../store/ui';
import { IconButton } from '../common';
import {
  IconFilm,
  IconMagnet,
  IconMusic,
  IconPlus,
  IconScissors,
  IconTransition,
  IconTrash,
  IconType,
  IconVolume,
  IconVolumeOff,
  IconZoomIn,
  IconZoomOut,
} from '../icons';
import { ASSET_DRAG_TYPE } from '../MediaPanel';
import { ClipView } from './ClipView';
import { HEADER_W, ROW_H, RULER_H, SLIDER_MAX, TAIL_FRAMES, sliderToZoom, zoomToSlider } from './layout';
import { Ruler } from './Ruler';
import { assetDrag, TRANSITION_DRAG_TYPE, useTimelineView } from './view';

function Toolbar() {
  const snap = useUI((s) => s.snap);
  const ppf = useUI((s) => s.pxPerFrame);
  const selected = useUI((s) => s.selectedClipId);
  const zoomBy = (f: number) => useUI.getState().setZoom(clampZoom(useUI.getState().pxPerFrame * f));
  const addTrack = (kind: 'video' | 'audio') => useProject.getState().addTrack(kind);
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-neutral-800 px-2">
      <IconButton label={ko.timeline.split} tooltip={withKey(ko.timeline.split, ko.keys.split)} onClick={actions.splitAtPlayhead} testId="split">
        <IconScissors />
      </IconButton>
      <IconButton
        label={ko.timeline.delete}
        tooltip={withKey(ko.timeline.delete, ko.keys.delete)}
        onClick={actions.deleteSelected}
        disabled={!selected}
        testId="delete"
      >
        <IconTrash />
      </IconButton>
      <div className="mx-1 h-5 w-px bg-neutral-800" />
      <IconButton label={ko.timeline.addVideoTrack} onClick={() => addTrack('video')} testId="add-video-track">
        <IconPlus />
        <span className="text-xs">{ko.timeline.videoTrackShort}</span>
      </IconButton>
      <IconButton label={ko.timeline.addAudioTrack} onClick={() => addTrack('audio')} testId="add-audio-track">
        <IconPlus />
        <span className="text-xs">{ko.timeline.audioTrackShort}</span>
      </IconButton>
      <div className="flex-1" />
      <IconButton label={ko.timeline.snap} pressed={snap} onClick={() => useUI.getState().setSnap(!snap)} testId="snap">
        <IconMagnet />
        <span className="text-xs">{ko.timeline.snap}</span>
      </IconButton>
      <div className="mx-1 h-5 w-px bg-neutral-800" />
      <IconButton label={ko.timeline.zoomOut} onClick={() => zoomBy(1 / 1.5)} testId="zoom-out">
        <IconZoomOut />
      </IconButton>
      <input
        type="range"
        aria-label={ko.timeline.zoom}
        title={ko.timeline.zoom}
        min={0}
        max={SLIDER_MAX}
        value={zoomToSlider(ppf)}
        onChange={(e) => useUI.getState().setZoom(sliderToZoom(Number(e.target.value)))}
        className="w-32 accent-cyan-400"
      />
      <IconButton label={ko.timeline.zoomIn} onClick={() => zoomBy(1.5)} testId="zoom-in">
        <IconZoomIn />
      </IconButton>
    </div>
  );
}

const KIND_ICON = { text: <IconType />, video: <IconFilm />, audio: <IconMusic /> };

function TrackHeader({ track }: { track: Track }) {
  const toggleMute = () => useProject.getState().setTrackMuted(track.id, !track.muted);
  return (
    <div
      className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r border-b border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-300"
      style={{ width: HEADER_W, height: ROW_H[track.kind] }}
    >
      <span className="text-neutral-500">{KIND_ICON[track.kind]}</span>
      <span className="min-w-0 flex-1 truncate">{track.name}</span>
      {track.kind !== 'text' && (
        <IconButton
          label={track.muted ? ko.timeline.unmute : ko.timeline.mute}
          pressed={track.muted}
          onClick={toggleMute}
          className="h-6 min-w-6 px-1"
        >
          {track.muted ? <IconVolumeOff /> : <IconVolume />}
        </IconButton>
      )}
    </div>
  );
}

/** 끌고 있는 미디어가 이 트랙에 들어갈 수 있는지 (R4.5) */
function acceptsDraggedAsset(track: Track, id: string | null): boolean {
  const asset = id ? useProject.getState().assets[id] : undefined;
  return !!asset && trackKindFor(asset.kind) === track.kind;
}

/** 트랜지션을 놓을 수 있는 거리 (화면 px) */
const TRANSITION_DROP_PX = 28;

/** 트랜지션 표시(경계 위 작은 막대)와, 트랜지션을 끄는 동안 놓을 수 있는 경계 표시 */
function TransitionMarks({ track, dropCut }: { track: Track; dropCut: string | null }) {
  const ppf = useUI((s) => s.pxPerFrame);
  const selected = useUI((s) => s.selectedTransition);
  const dragging = useTimelineView((s) => s.transitionDrag);
  const wins = transitionsOf(track);
  const targets = dragging ? cutsOf(track) : [];
  return (
    <>
      {wins.map((w) => {
        const real = w.duration * ppf;
        const width = Math.max(14, real);
        const left = width > real ? w.cut * ppf - width / 2 : w.start * ppf;
        const label = ko.timeline.transition(ko.effects.transitions[w.kind] ?? w.kind);
        return (
          <button
            key={w.to.id}
            type="button"
            data-testid="transition"
            data-to-clip-id={w.to.id}
            data-kind={w.kind}
            data-selected={selected === w.to.id}
            aria-label={label}
            title={label}
            onPointerDown={(e) => {
              e.stopPropagation();
              useUI.getState().selectTransition(w.to.id);
            }}
            className={
              'absolute top-1/2 z-[6] flex h-5 -translate-y-1/2 items-center justify-center rounded text-white shadow ' +
              (selected === w.to.id ? 'bg-cyan-400 ring-2 ring-white' : 'bg-cyan-600/90 hover:bg-cyan-500')
            }
            style={{ left, width }}
          >
            <IconTransition />
          </button>
        );
      })}
      {targets.map((c) => (
        <div
          key={c.to.id}
          data-testid="cut-target"
          data-to-clip-id={c.to.id}
          aria-hidden="true"
          className={
            'pointer-events-none absolute inset-y-1 z-[6] w-3 -translate-x-1/2 rounded ' +
            (dropCut === c.to.id ? 'bg-cyan-300 ring-2 ring-white' : 'bg-cyan-400/50')
          }
          style={{ left: c.frame * ppf }}
        />
      ))}
    </>
  );
}

function TrackLane({ track, width, scroller }: { track: Track; width: number; scroller: HTMLDivElement | null }) {
  const [dropping, setDropping] = useState(false);
  const [dropCut, setDropCut] = useState<string | null>(null);
  /** 끄는 중인 트랜지션을 놓을 경계 (포인터에서 가까운 것) */
  const cutUnder = (e: DragEvent) => {
    const z = useUI.getState().pxPerFrame;
    const frame = (e.clientX - e.currentTarget.getBoundingClientRect().left) / z;
    return nearestCut(track, frame, TRANSITION_DROP_PX / z);
  };
  const onDragOver = (e: DragEvent) => {
    if (useTimelineView.getState().transitionDrag) {
      const cut = track.kind === 'video' ? cutUnder(e) : null;
      setDropCut(cut?.to.id ?? null);
      if (!cut) return; // 경계 근처가 아니면 놓을 수 없음
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      return;
    }
    if (!acceptsDraggedAsset(track, assetDrag.id)) return; // 기본 동작을 막지 않으면 "놓을 수 없음" 커서
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  };
  const onDrop = (e: DragEvent) => {
    const kind = useTimelineView.getState().transitionDrag ?? ((e.dataTransfer.getData(TRANSITION_DRAG_TYPE) || null) as TransitionKind | null);
    if (kind) {
      const cut = track.kind === 'video' ? cutUnder(e) : null;
      setDropCut(null);
      useTimelineView.getState().set({ transitionDrag: null });
      if (!cut) return;
      e.preventDefault();
      actions.applyTransition(kind, { trackId: track.id, toClipId: cut.to.id });
      return;
    }
    const id = assetDrag.id ?? e.dataTransfer.getData(ASSET_DRAG_TYPE);
    setDropping(false);
    if (!acceptsDraggedAsset(track, id)) return;
    e.preventDefault();
    const { pxPerFrame: z, snap, playhead } = useUI.getState();
    let frame = Math.max(0, Math.round((e.clientX - e.currentTarget.getBoundingClientRect().left) / z));
    if (snap) frame = snapValue(frame, snapCandidates(useProject.getState().edit, null, playhead), SNAP_THRESHOLD_PX / z).value;
    actions.addAssetToTimeline(id, track.id, frame);
    assetDrag.id = null;
  };
  return (
    <div
      data-testid="track-lane"
      data-track-id={track.id}
      data-kind={track.kind}
      className={'relative shrink-0 border-b border-neutral-800 ' + (dropping ? 'bg-cyan-500/10' : 'bg-neutral-950/60')}
      style={{ width, height: ROW_H[track.kind] }}
      onDragOver={onDragOver}
      onDragLeave={() => {
        setDropping(false);
        setDropCut(null);
      }}
      onDrop={onDrop}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) useUI.getState().select(null);
      }}
    >
      {track.clips.map((c) => (
        <ClipView key={c.id} clip={c} rowKind={track.kind} scroller={scroller} />
      ))}
      {track.kind === 'video' && <TransitionMarks track={track} dropCut={dropCut} />}
    </div>
  );
}

function Playhead({ height }: { height: number }) {
  const playhead = useUI((s) => s.playhead);
  const ppf = useUI((s) => s.pxPerFrame);
  return (
    <div
      data-testid="playhead"
      className="pointer-events-none absolute top-0 z-10 w-px bg-cyan-300"
      style={{ height, transform: `translateX(${HEADER_W + playhead * ppf}px)` }}
    >
      <div className="absolute -top-px -left-[5px] h-0 w-0 border-x-[5px] border-t-[8px] border-x-transparent border-t-cyan-300" />
    </div>
  );
}

function SnapLine({ height }: { height: number }) {
  const line = useTimelineView((s) => s.snapLine);
  const ppf = useUI((s) => s.pxPerFrame);
  if (line === null) return null;
  return (
    <div
      data-testid="snap-line"
      className="pointer-events-none absolute top-0 z-10 w-px bg-yellow-300"
      style={{ height, transform: `translateX(${HEADER_W + line * ppf}px)` }}
    />
  );
}

/** 줌할 때 기준점(커서 또는 플레이헤드)이 화면에서 제자리에 있도록 스크롤을 맞춘다 */
function useZoomAnchor(scroller: HTMLDivElement | null, ppf: number) {
  const anchor = useRef<{ frame: number; screenX: number } | null>(null);
  const prev = useRef(ppf);
  useLayoutEffect(() => {
    const el = scroller;
    const old = prev.current;
    prev.current = ppf;
    if (!el || old === ppf) return;
    let a = anchor.current;
    anchor.current = null;
    if (!a) {
      const ph = useUI.getState().playhead;
      const phX = ph * old - el.scrollLeft;
      a = phX >= 0 && phX <= el.clientWidth - HEADER_W ? { frame: ph, screenX: phX } : { frame: el.scrollLeft / old, screenX: 0 };
    }
    el.scrollLeft = Math.max(0, a.frame * ppf - a.screenX);
  }, [scroller, ppf]);

  // Ctrl+휠: 커서 위치 기준 확대/축소 (R5.7). 브라우저 확대를 막으려면 passive: false여야 한다.
  useEffect(() => {
    const el = scroller;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const screenX = Math.max(0, e.clientX - el.getBoundingClientRect().left - HEADER_W);
      const z = useUI.getState().pxPerFrame;
      anchor.current = { frame: (el.scrollLeft + screenX) / z, screenX };
      useUI.getState().setZoom(clampZoom(z * Math.exp(-e.deltaY * 0.0015)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scroller]);
}

export function Timeline() {
  const tracks = useProject((s) => s.edit.tracks);
  const duration = useProject((s) => editDuration(s.edit));
  const ppf = useUI((s) => s.pxPerFrame);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [viewW, setViewW] = useState(0);

  // 스크롤 위치/보이는 너비 → 클립 캔버스가 보이는 부분만 그리는 데 쓴다
  useEffect(() => {
    const el = scroller;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      useTimelineView.getState().set({ scrollLeft: el.scrollLeft, viewW: el.clientWidth - HEADER_W });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    const ro = new ResizeObserver(() => {
      setViewW(el.clientWidth);
      update();
    });
    ro.observe(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, [scroller]);

  useZoomAnchor(scroller, ppf);

  // 재생 중 플레이헤드가 화면 밖으로 나가면 따라가며 넘긴다
  useEffect(() => {
    if (!scroller) return;
    return useUI.subscribe((s, p) => {
      if (!s.playing || s.playhead === p.playhead) return;
      const x = s.playhead * s.pxPerFrame;
      const w = scroller.clientWidth - HEADER_W;
      if (x > scroller.scrollLeft + w - 24 || x < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, x - 24);
    });
  }, [scroller]);

  const laneWidth = Math.max(viewW - HEADER_W, Math.ceil((duration + TAIL_FRAMES) * ppf));
  const contentH = RULER_H + tracks.reduce((h, t) => h + ROW_H[t.kind], 0);

  return (
    <section aria-label={ko.timeline.region} className="flex min-h-0 min-w-0 flex-col border-t border-neutral-800 bg-neutral-900" data-testid="timeline">
      <Toolbar />
      <div ref={setScroller} className="relative min-h-0 flex-1 overflow-auto" data-testid="timeline-scroller">
        <div className="relative" style={{ width: HEADER_W + laneWidth, minHeight: contentH }}>
          <div className="sticky top-0 z-30 flex bg-neutral-900">
            <div className="sticky left-0 z-40 shrink-0 border-r border-b border-neutral-800 bg-neutral-900" style={{ width: HEADER_W, height: RULER_H }} />
            <Ruler scroller={scroller} laneWidth={laneWidth} />
          </div>
          {tracks.map((t) => (
            <div key={t.id} className="flex">
              <TrackHeader track={t} />
              <TrackLane track={t} width={laneWidth} scroller={scroller} />
            </div>
          ))}
          <SnapLine height={contentH} />
          <Playhead height={contentH} />
        </div>
      </div>
    </section>
  );
}
