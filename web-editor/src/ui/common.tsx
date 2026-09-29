import type { ReactNode } from 'react';

/** 아이콘 버튼. label은 스크린리더/툴팁용 (ko.ts에서 가져온 문자열). */
export function IconButton(props: {
  label: string;
  tooltip?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const { label, tooltip, onClick, disabled, pressed, children, className, testId } = props;
  return (
    <button
      type="button"
      aria-label={label}
      title={tooltip ?? label}
      aria-pressed={pressed}
      disabled={disabled}
      data-testid={testId}
      onClick={onClick}
      className={
        'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-neutral-200 ' +
        'hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent ' +
        (pressed ? 'bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 ' : '') +
        (className ?? '')
      }
    >
      {children}
    </button>
  );
}
