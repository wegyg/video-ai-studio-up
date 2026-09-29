/**
 * 미리보기 직접 조작 (R6.4): 선택 상자, 모서리 4개로 크기, 회전 핸들로 회전, 안쪽을 끌어 이동.
 * - 클릭: 그 지점의 가장 위 클립 선택(회전 고려), 빈 곳이면 선택 해제
 * - 드래그 한 번 = 실행 취소 기록 1개, Esc로 취소
 * - 상자 위치는 rAF로 직접 갱신한다(React 재렌더링 없이 영상 로딩·플레이헤드 변화를 따라감)
 */
import { useEffect, useRef, useState } from 'react';
import { actions } from '../../actions';
import { previewRef } from '../../engine/preview/PreviewEngine';
import { SAFE_AREA } from '../../engine/text';
import { CORNERS, normalizeAngle, rotationFromPointer, scaleFromCorner, snapAngle, type HandleId, type Point } from '../../engine/geometry';
import { ko } from '../../i18n/ko';
import { findClip } from '../../model/ops';
import { RATIO_SIZE, type TextClip, type Transform } from '../../model/types';
import { history } from '../../store/history';
// (history는 드래그 제스처와 인라인 편집 모두에서 쓴다)
import { useProject } from '../../store/project';
import { useUI } from '../../store/ui';

const HANDLE_CURSOR: Record<HandleId, string> = {
  tl: 'nwse-resize',
  br: 'nwse-resize',
  tr: 'nesw-resize',
  bl: 'nesw-resize',
  rot: 'grab',
};

const round = (v: number, digits = 0) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

/** 쇼츠 UI에 가려지는 영역 안내선 (R7.9). 화면에만 그리고 내보낸 영상에는 들어가지 않는다 */
function SafeAreaGuides() {
  const on = useUI((s) => s.safeArea);
  if (!on) return null;
  const pct = (v: number) => `${v * 100}%`;
  return (
    <div data-testid="safe-area" className="pointer-events-none absolute inset-0">
      <div className="absolute inset-x-0 top-0 border-b border-dashed border-amber-400/70 bg-amber-400/10" style={{ height: pct(SAFE_AREA.top) }} />
      <div className="absolute inset-x-0 bottom-0 border-t border-dashed border-amber-400/70 bg-amber-400/10" style={{ height: pct(SAFE_AREA.bottom) }} />
      <div className="absolute inset-y-0 left-0 border-r border-dashed border-amber-400/40" style={{ width: pct(SAFE_AREA.side) }} />
      <div className="absolute inset-y-0 right-0 border-l border-dashed border-amber-400/40" style={{ width: pct(SAFE_AREA.side) }} />
    </div>
  );
}

/**
 * 미리보기에서 두 번 눌러 글자를 바로 고치기 (R7.5).
 * 치는 대로 캔버스에 반영되고(반투명 입력칸 뒤로 보인다), 끝나면 실행 취소 기록 1개. Esc는 처음 글자로 되돌린다.
 */
function InlineEditor({ clip, onDone }: { clip: TextClip; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    history.beginGesture();
    el.focus();
    el.select();
    return () => {
      if (!done.current) history.endGesture();
    };
  }, []);
  const setText = (v: string) => useProject.getState().updateClip(clip.id, (c) => ({ ...c, text: v }) as typeof c);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) history.endGesture();
    else history.cancelGesture(); // 편집 전 상태로
    onDone();
  };
  return (
    <textarea
      ref={ref}
      data-testid="inline-text-editor"
      aria-label={ko.textProps.content}
      defaultValue={clip.text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') finish(false);
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(true);
      }}
      className="pointer-events-auto absolute inset-0 size-full resize-none rounded bg-black/25 p-1 text-center text-white/60 outline-2 outline-cyan-300"
      style={{ fontSize: 16 }}
    />
  );
}

export function SelectionOverlay() {
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingClip = useProject((s) => (editingId ? (findClip(s.edit, editingId)?.clip ?? null) : null));

  // 상자/핸들 위치를 매 화면 갱신마다 직접 반영
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const root = rootRef.current;
      const boxEl = boxRef.current;
      if (!root || !boxEl) return;
      const id = useUI.getState().selectedClipId;
      const box = id ? (previewRef.current?.boxOf(id) ?? null) : null;
      if (!box) {
        if (boxEl.style.display !== 'none') boxEl.style.display = 'none';
        return;
      }
      const { width: W } = RATIO_SIZE[useProject.getState().edit.ratio];
      const s = root.clientWidth / W; // 프로젝트 px → 화면 px
      boxEl.style.display = '';
      boxEl.style.width = `${box.w * s}px`;
      boxEl.style.height = `${box.h * s}px`;
      boxEl.style.transform = `translate(${box.cx * s}px, ${box.cy * s}px) translate(-50%, -50%) rotate(${box.rotation}deg)`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** 화면 좌표 → 프로젝트 좌표 */
  const toProject = (clientX: number, clientY: number): Point => {
    const root = rootRef.current!;
    const r = root.getBoundingClientRect();
    const { width: W } = RATIO_SIZE[useProject.getState().edit.ratio];
    const k = W / r.width;
    return { x: (clientX - r.left) * k, y: (clientY - r.top) * k };
  };

  /** 크기/회전/이동 공통 드래그 */
  const startGesture = (e: React.PointerEvent, clipId: string, kind: HandleId | 'move') => {
    const engine = previewRef.current;
    const startBox = engine?.boxOf(clipId);
    const loc = findClip(useProject.getState().edit, clipId);
    if (!engine || !startBox || !loc || loc.clip.type === 'audio') return;
    e.preventDefault();
    e.stopPropagation();
    actions.pause(); // 재생 중이면 멈춰서 상자가 커서 밑에서 움직이지 않게 한다
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const startT: Transform = loc.clip.transform;
    const p0 = toProject(e.clientX, e.clientY);
    const startAngle = rotationFromPointer(p0, startBox);
    let moved = false;
    history.beginGesture();

    const setTransform = (patch: Partial<Transform>) =>
      useProject.getState().updateClip(clipId, (c) => ({ ...c, transform: { ...c.transform, ...patch } }));

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const p = toProject(ev.clientX, ev.clientY);
      if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 2) return;
      moved = true;
      if (kind === 'move') {
        setTransform({ x: round(startT.x + (p.x - p0.x)), y: round(startT.y + (p.y - p0.y)) });
      } else if (kind === 'rot') {
        const delta = normalizeAngle(rotationFromPointer(p, startBox) - startAngle);
        const raw = normalizeAngle(startT.rotation + delta);
        setTransform({ rotation: round(ev.shiftKey ? raw : snapAngle(raw), 1) });
      } else {
        setTransform({ scale: round(scaleFromCorner(p, startBox, startT.scale), 3) });
      }
    };
    let done = false;
    const cleanup = () => {
      done = true;
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onCancel);
      target.removeEventListener('lostpointercapture', onUp);
      window.removeEventListener('keydown', onKey, true);
      if (target.hasPointerCapture(e.pointerId)) target.releasePointerCapture(e.pointerId);
    };
    const onUp = () => {
      if (done) return;
      cleanup();
      history.endGesture();
    };
    const onCancel = () => {
      if (done) return;
      cleanup();
      history.cancelGesture();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.code === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        onCancel();
      }
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);
    target.addEventListener('lostpointercapture', onUp);
    window.addEventListener('keydown', onKey, true);
  };

  /** 빈 곳/클립 위 클릭 → 선택 + 이동 시작 */
  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || editingId) return;
    const engine = previewRef.current;
    if (!engine) return;
    const hit = engine.hitTest(toProject(e.clientX, e.clientY));
    useUI.getState().select(hit);
    if (hit) startGesture(e, hit, 'move');
  };

  /** 텍스트를 두 번 누르면 바로 고치기 (R7.5) */
  const onDoubleClick = (e: React.MouseEvent) => {
    const engine = previewRef.current;
    if (!engine) return;
    const hit = engine.hitTest(toProject(e.clientX, e.clientY));
    const clip = hit ? findClip(useProject.getState().edit, hit)?.clip : null;
    if (clip?.type === 'text') {
      actions.pause();
      useUI.getState().select(clip.id);
      setEditingId(clip.id);
    }
  };

  return (
    <div
      ref={rootRef}
      data-testid="preview-overlay"
      className="absolute inset-0 touch-none"
      onPointerDown={onBackgroundDown}
      onDoubleClick={onDoubleClick}
      aria-hidden="true"
    >
      <SafeAreaGuides />
      <div
        ref={boxRef}
        data-testid="selection-box"
        style={{ display: 'none', position: 'absolute', left: 0, top: 0, transformOrigin: 'center' }}
        className="pointer-events-none outline-2 outline-cyan-300/90"
      >
        {CORNERS.map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`handle-${id}`}
            aria-label={ko.preview.handles[id]}
            title={ko.preview.handles[id]}
            onPointerDown={(e) => {
              const sel = useUI.getState().selectedClipId;
              if (sel) startGesture(e, sel, id);
            }}
            style={{ cursor: HANDLE_CURSOR[id] }}
            className={
              'pointer-events-auto absolute size-3 rounded-sm border border-neutral-900 bg-cyan-300 ' +
              (id === 'tl' ? '-top-1.5 -left-1.5 ' : '') +
              (id === 'tr' ? '-top-1.5 -right-1.5 ' : '') +
              (id === 'br' ? '-right-1.5 -bottom-1.5 ' : '') +
              (id === 'bl' ? '-bottom-1.5 -left-1.5 ' : '')
            }
          />
        ))}
        {/* 회전 핸들은 상자 '안쪽' 아래 가운데에 둔다. 밖에 두면 미리보기 영역(overflow-hidden)에 잘려 클릭되지 않는다 */}
        <button
          type="button"
          data-testid="handle-rot"
          aria-label={ko.preview.handles.rot}
          title={ko.preview.handles.rot}
          onPointerDown={(e) => {
            const sel = useUI.getState().selectedClipId;
            if (sel) startGesture(e, sel, 'rot');
          }}
          style={{ cursor: HANDLE_CURSOR.rot }}
          className="pointer-events-auto absolute bottom-2 left-1/2 size-3.5 -translate-x-1/2 rounded-full border border-neutral-900 bg-cyan-300"
        />
        {editingClip?.type === 'text' && <InlineEditor clip={editingClip} onDone={() => setEditingId(null)} />}
      </div>
    </div>
  );
}
