/** 좌측 텍스트 탭: 텍스트 추가 + 스타일 프리셋 20종 (R7.6) */
import { actions } from '../actions';
import { ko } from '../i18n/ko';
import { TEXT_PRESETS, type TextPreset } from '../model/text-presets';
import { IconPlus } from './icons';

/** 프리셋 미리보기: 실제 값(색·외곽선·박스·그림자)을 CSS로 비슷하게 보여 준다 */
function presetPreviewStyle(p: TextPreset): React.CSSProperties {
  const s = p.style;
  const scale = 22 / s.size; // 목록용 작은 크기로 환산
  const shadow = s.shadow.enabled
    ? `${s.shadow.offsetX * scale}px ${s.shadow.offsetY * scale}px ${s.shadow.blur * scale}px ${s.shadow.color}`
    : undefined;
  return {
    color: s.color,
    fontFamily: `"${s.font}", sans-serif`,
    fontWeight: s.weight,
    WebkitTextStrokeWidth: s.stroke.width > 0 ? `${Math.max(0.5, s.stroke.width * scale)}px` : undefined,
    WebkitTextStrokeColor: s.stroke.color,
    paintOrder: 'stroke fill',
    textShadow: shadow,
    background: s.box.enabled ? s.box.color : undefined,
    opacity: s.box.enabled ? undefined : 1,
    borderRadius: s.box.enabled ? `${Math.max(2, s.box.radius * scale)}px` : undefined,
    padding: s.box.enabled ? '2px 6px' : undefined,
  };
}

export function TextPanel() {
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        data-testid="add-text"
        onClick={() => actions.addTextClip()}
        className="flex h-9 items-center justify-center gap-2 rounded-md bg-cyan-600 text-sm font-bold text-white hover:bg-cyan-500"
      >
        <IconPlus />
        {ko.textPanel.add}
      </button>
      <div>
        <h3 className="mb-1 text-xs font-bold text-neutral-300">{ko.textPanel.presets}</h3>
        <p className="mb-2 text-[11px] leading-relaxed text-neutral-500">{ko.textPanel.presetHint}</p>
        <div className="grid grid-cols-2 gap-2" data-testid="text-presets">
          {TEXT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              data-testid="text-preset"
              data-preset-id={p.id}
              aria-label={p.name}
              title={p.name}
              onClick={() => actions.applyTextPreset(p.style)}
              className="flex h-16 flex-col items-stretch overflow-hidden rounded-md bg-neutral-800 ring-1 ring-neutral-700/60 hover:ring-cyan-500"
            >
              {/* 어두운 글씨(기본 검정 등)도 보이도록 밝고 어두운 부분이 함께 있는 배경을 깐다 */}
              <span className="flex flex-1 items-center justify-center bg-gradient-to-r from-neutral-900 via-neutral-600 to-neutral-300">
                <span className="text-[22px] leading-none" style={presetPreviewStyle(p)}>
                  {ko.textPanel.sample}
                </span>
              </span>
              <span className="w-full truncate px-1 py-0.5 text-center text-[10px] text-neutral-400">{p.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
