import { useEffect, useState } from 'react';
import { actions } from '../../actions';
import { ko, withKey } from '../../i18n/ko';
import { editDuration } from '../../model/time';
import type { Track } from '../../model/types';
import { useProject } from '../../store/project';
import { clampZoom, useUI } from '../../store/ui';
import { IconButton } from '../common';
import { IconFilm, IconMagnet, IconMusic, IconScissors, IconTrash, IconType, IconVolume, IconVolumeOff, IconZoomIn, IconZoomOut } from '../icons';
import { HEADER_W, ROW_H, RULER_H, SLIDER_MAX, TAIL_FRAMES, sliderToZoom, zoomToSlider } from './layout';
import { Ruler } from './Ruler';

function Toolbar() {
  const snap = useUI((s) => s.snap);
  const ppf = useUI((s) => s.pxPerFrame);
  const selected = useUI((s) => s.selectedClipId);
  const zoomBy = (f: number) => useUI.getState().setZoom(clampZoom(useUI.getState().pxPerFrame * f));
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
      <div className="flex-1" />
      <IconButton label={ko.timeline.snap} pressed={snap} onClick={() => useUI.getState().setSnap(!snap)} testId="snap">
        <IconMagnet />
        <span className="text-xs">{ko.timeline.snap}</span>
      </IconButton>
      <div className="mx-1 h-5 w-px bg-neutral-800" />
      <IconButton label={ko.timeline.zoomOut} onClick={() => zoomBy(1 / 1.5)}>
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
      <IconButton label={ko.timeline.zoomIn} onClick={() => zoomBy(1.5)}>
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

function TrackLane({ track, width }: { track: Track; width: number }) {
  return (
    <div
      data-testid="track-lane"
      data-track-id={track.id}
      data-kind={track.kind}
      className="relative shrink-0 border-b border-neutral-800 bg-neutral-950/60"
      style={{ width, height: ROW_H[track.kind] }}
    />
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

export function Timeline() {
  const tracks = useProject((s) => s.edit.tracks);
  const duration = useProject((s) => editDuration(s.edit));
  const ppf = useUI((s) => s.pxPerFrame);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [viewW, setViewW] = useState(0);

  useEffect(() => {
    if (!scroller) return;
    const ro = new ResizeObserver(() => setViewW(scroller.clientWidth));
    ro.observe(scroller);
    return () => ro.disconnect();
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
              <TrackLane track={t} width={laneWidth} />
            </div>
          ))}
          <Playhead height={contentH} />
        </div>
      </div>
    </section>
  );
}
