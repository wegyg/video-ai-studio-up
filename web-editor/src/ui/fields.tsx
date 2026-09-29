/**
 * 속성 패널 입력칸. 편집 단위를 지켜서 실행 취소가 깔끔하게 남게 한다.
 *  - NumberField: 타이핑 중에는 반영하지 않고 Enter나 포커스가 떠날 때 한 번 적용 → 기록 1개
 *  - SliderField: 누르는 순간 제스처 시작, 떼면 끝 → 끌기 한 번이 기록 1개
 */
import { useEffect, useRef, useState } from 'react';
import { history } from '../store/history';

interface Common {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** 화면에 보일 단위 */
  unit?: string;
  /** 값 → 화면 표시값 (예: 0~1 투명도를 0~100%로) */
  toView?: (v: number) => number;
  /** 화면 표시값 → 값 */
  fromView?: (v: number) => number;
  onCommit: (v: number) => void;
  testId?: string;
  disabled?: boolean;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function NumberField(props: Common) {
  const { label, value, min, max, step = 1, unit, toView = (v) => v, fromView = (v) => v, onCommit, testId, disabled } = props;
  const view = toView(value);
  const [text, setText] = useState(String(view));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(String(Math.round(view * 100) / 100));
  }, [view]);

  const commit = () => {
    editing.current = false;
    const n = Number(text);
    if (Number.isFinite(n)) onCommit(clamp(fromView(n), min, max));
    else setText(String(Math.round(view * 100) / 100));
  };

  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-neutral-400">{label}</span>
      <input
        type="number"
        aria-label={label}
        data-testid={testId}
        disabled={disabled}
        value={text}
        step={step}
        onFocus={() => (editing.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            editing.current = false;
            setText(String(Math.round(view * 100) / 100));
            e.currentTarget.blur();
          }
        }}
        className="h-7 min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-800 px-2 text-right tabular-nums text-neutral-100 focus:border-cyan-500 focus:outline-none disabled:opacity-40"
      />
      {unit && <span className="w-4 shrink-0 text-neutral-500">{unit}</span>}
    </label>
  );
}

export function SliderField(props: Common) {
  const { label, value, min, max, step = 1, unit, toView = (v) => v, fromView = (v) => v, onCommit, testId, disabled } = props;
  const view = toView(value);
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-neutral-400">{label}</span>
      <input
        type="range"
        aria-label={label}
        data-testid={testId}
        disabled={disabled}
        min={toView(min)}
        max={toView(max)}
        step={step}
        value={view}
        onPointerDown={() => history.beginGesture()}
        onPointerUp={() => history.endGesture()}
        onChange={(e) => onCommit(clamp(fromView(Number(e.target.value)), min, max))}
        // 키보드로 조절할 때는 제스처가 없으므로 값 변경이 그대로 기록된다
        onKeyDown={() => history.endGesture()}
        className="min-w-0 flex-1 accent-cyan-400 disabled:opacity-40"
      />
      <span className="w-10 shrink-0 text-right tabular-nums text-neutral-300">
        {Math.round(view)}
        {unit}
      </span>
    </label>
  );
}
