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


/** 색 고르기 (값은 #rrggbb) */
export function ColorField({ label, value, onCommit, testId }: { label: string; value: string; onCommit: (v: string) => void; testId?: string }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-neutral-400">{label}</span>
      <input
        type="color"
        aria-label={label}
        data-testid={testId}
        value={value}
        onChange={(e) => onCommit(e.target.value)}
        className="h-7 w-10 cursor-pointer rounded border border-neutral-700 bg-neutral-800"
      />
      <span className="font-mono text-neutral-500">{value}</span>
    </label>
  );
}

/** 목록에서 고르기 */
export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onCommit,
  testId,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onCommit: (v: T) => void;
  testId?: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-neutral-400">{label}</span>
      <select
        aria-label={label}
        data-testid={testId}
        value={String(value)}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onCommit(opt.value);
        }}
        className="h-7 min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-800 px-1.5 text-neutral-100 focus:border-cyan-500 focus:outline-none"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 켜기/끄기 */
export function CheckField({ label, value, onCommit, testId }: { label: string; value: boolean; onCommit: (v: boolean) => void; testId?: string }) {
  return (
    <label className="flex items-center gap-2 text-xs text-neutral-300">
      <input
        type="checkbox"
        aria-label={label}
        data-testid={testId}
        checked={value}
        onChange={(e) => onCommit(e.target.checked)}
        className="size-3.5 accent-cyan-400"
      />
      {label}
    </label>
  );
}

/** 여러 줄 글자 입력 (Enter는 줄바꿈, 포커스가 떠날 때 적용) */
export function TextAreaField({
  label,
  value,
  placeholder,
  onCommit,
  testId,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
  testId?: string;
}) {
  const [text, setText] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(value);
  }, [value]);
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-neutral-400">{label}</span>
      <textarea
        aria-label={label}
        data-testid={testId}
        rows={2}
        value={text}
        placeholder={placeholder}
        onFocus={() => (editing.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          editing.current = false;
          onCommit(text);
        }}
        className="resize-y rounded border border-neutral-700 bg-neutral-800 px-2 py-1 text-neutral-100 focus:border-cyan-500 focus:outline-none"
      />
    </label>
  );
}
