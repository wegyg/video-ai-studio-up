/** 우측 속성 패널의 텍스트 서식 (R7.2~R7.4, R7.7) */
import { ko } from '../i18n/ko';
import { FONT_FAMILIES } from '../fonts';
import { FPS, type Clip, type TextAlign, type TextAnim, type TextAnimType, type TextClip, type TextFont, type TextWeight } from '../model/types';
import { useProject } from '../store/project';
import { CheckField, ColorField, NumberField, SelectField, SliderField, TextAreaField } from './fields';

const ANIM_TYPES: TextAnimType[] = ['none', 'fade', 'pop', 'typewriter', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'bounce', 'zoom'];
const WEIGHTS: TextWeight[] = [400, 700, 900];
const ALIGNS: TextAlign[] = ['left', 'center', 'right'];

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-neutral-800 px-3 py-3">
      {title && <h3 className="mb-2 text-xs font-bold text-neutral-300">{title}</h3>}
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

export function TextProps({ clip }: { clip: TextClip }) {
  const set = (patch: Partial<TextClip>) => useProject.getState().updateClip(clip.id, (c) => ({ ...c, ...patch }) as Clip);
  const setAnim = (key: 'animIn' | 'animOut', patch: Partial<TextAnim>) => set({ [key]: { ...clip[key], ...patch } } as Partial<TextClip>);
  const animOptions = ANIM_TYPES.map((t) => ({ value: t, label: ko.textProps.anims[t] }));

  return (
    <>
      <Section>
        <TextAreaField
          label={ko.textProps.content}
          testId="text-content"
          value={clip.text}
          placeholder={ko.textProps.contentPlaceholder}
          onCommit={(text) => set({ text })}
        />
        <p className="text-[11px] text-neutral-500">{ko.textProps.editHint}</p>
        <SelectField
          label={ko.textProps.font}
          testId="text-font"
          value={clip.font}
          options={FONT_FAMILIES.map((f) => ({ value: f as TextFont, label: f }))}
          onCommit={(font) => set({ font })}
        />
        <NumberField label={ko.textProps.size} testId="text-size" value={clip.size} min={8} max={400} onCommit={(size) => set({ size })} />
        <SelectField
          label={ko.textProps.weight}
          testId="text-weight"
          value={clip.weight}
          options={WEIGHTS.map((w) => ({ value: w, label: ko.textProps.weights[w] }))}
          onCommit={(weight) => set({ weight })}
        />
        <ColorField label={ko.textProps.color} testId="text-color" value={clip.color} onCommit={(color) => set({ color })} />
        <SelectField
          label={ko.textProps.align}
          testId="text-align"
          value={clip.align}
          options={ALIGNS.map((a) => ({ value: a, label: ko.textProps.aligns[a] }))}
          onCommit={(align) => set({ align })}
        />
        <NumberField
          label={ko.textProps.lineHeight}
          testId="text-line-height"
          value={clip.lineHeight}
          min={0.8}
          max={3}
          step={0.05}
          onCommit={(lineHeight) => set({ lineHeight })}
        />
      </Section>

      <Section title={ko.textProps.sectionStroke}>
        <ColorField
          label={ko.textProps.colorOnly}
          testId="stroke-color"
          value={clip.stroke.color}
          onCommit={(color) => set({ stroke: { ...clip.stroke, color } })}
        />
        <NumberField
          label={ko.textProps.strokeWidth}
          testId="stroke-width"
          value={clip.stroke.width}
          min={0}
          max={40}
          onCommit={(width) => set({ stroke: { ...clip.stroke, width } })}
        />
      </Section>

      <Section title={ko.textProps.sectionBox}>
        <CheckField label={ko.textProps.useBox} testId="box-enabled" value={clip.box.enabled} onCommit={(enabled) => set({ box: { ...clip.box, enabled } })} />
        <ColorField label={ko.textProps.colorOnly} testId="box-color" value={clip.box.color} onCommit={(color) => set({ box: { ...clip.box, color } })} />
        <SliderField
          label={ko.textProps.boxOpacity}
          testId="box-opacity"
          value={clip.box.opacity}
          min={0}
          max={1}
          unit={ko.inspector.units.percent}
          toView={(v) => v * 100}
          fromView={(v) => v / 100}
          onCommit={(opacity) => set({ box: { ...clip.box, opacity } })}
        />
        <NumberField
          label={ko.textProps.boxPadding}
          testId="box-padding"
          value={clip.box.padding}
          min={0}
          max={200}
          onCommit={(padding) => set({ box: { ...clip.box, padding } })}
        />
        <NumberField
          label={ko.textProps.boxRadius}
          testId="box-radius"
          value={clip.box.radius}
          min={0}
          max={200}
          onCommit={(radius) => set({ box: { ...clip.box, radius } })}
        />
      </Section>

      <Section title={ko.textProps.sectionShadow}>
        <CheckField
          label={ko.textProps.useShadow}
          testId="shadow-enabled"
          value={clip.shadow.enabled}
          onCommit={(enabled) => set({ shadow: { ...clip.shadow, enabled } })}
        />
        <ColorField
          label={ko.textProps.colorOnly}
          testId="shadow-color"
          value={clip.shadow.color}
          onCommit={(color) => set({ shadow: { ...clip.shadow, color } })}
        />
        <NumberField
          label={ko.textProps.shadowBlur}
          testId="shadow-blur"
          value={clip.shadow.blur}
          min={0}
          max={120}
          onCommit={(blur) => set({ shadow: { ...clip.shadow, blur } })}
        />
        <NumberField
          label={ko.textProps.shadowX}
          testId="shadow-x"
          value={clip.shadow.offsetX}
          min={-100}
          max={100}
          onCommit={(offsetX) => set({ shadow: { ...clip.shadow, offsetX } })}
        />
        <NumberField
          label={ko.textProps.shadowY}
          testId="shadow-y"
          value={clip.shadow.offsetY}
          min={-100}
          max={100}
          onCommit={(offsetY) => set({ shadow: { ...clip.shadow, offsetY } })}
        />
      </Section>

      <Section title={ko.textProps.sectionTiming}>
        <NumberField
          label={ko.textProps.startAt}
          testId="text-start"
          value={clip.start}
          min={0}
          max={100000}
          step={0.1}
          unit={ko.inspector.units.second}
          toView={(v) => v / FPS}
          fromView={(v) => Math.round(v * FPS)}
          onCommit={(start) => useProject.getState().setClipStart(clip.id, start)}
        />
        <NumberField
          label={ko.textProps.endAt}
          testId="text-end"
          value={clip.start + clip.duration}
          min={0}
          max={100000}
          step={0.1}
          unit={ko.inspector.units.second}
          toView={(v) => v / FPS}
          fromView={(v) => Math.round(v * FPS)}
          onCommit={(end) => useProject.getState().trimClip(clip.id, 'end', end)}
        />
        <SelectField label={ko.textProps.animIn} testId="anim-in" value={clip.animIn.type} options={animOptions} onCommit={(type) => setAnim('animIn', { type })} />
        <NumberField
          label={ko.textProps.animDuration}
          testId="anim-in-duration"
          value={clip.animIn.duration}
          min={0}
          max={clip.duration}
          step={0.1}
          unit={ko.inspector.units.second}
          toView={(v) => v / FPS}
          fromView={(v) => Math.round(v * FPS)}
          onCommit={(duration) => setAnim('animIn', { duration })}
        />
        <SelectField
          label={ko.textProps.animOut}
          testId="anim-out"
          value={clip.animOut.type}
          options={animOptions}
          onCommit={(type) => setAnim('animOut', { type })}
        />
        <NumberField
          label={ko.textProps.animDuration}
          testId="anim-out-duration"
          value={clip.animOut.duration}
          min={0}
          max={clip.duration}
          step={0.1}
          unit={ko.inspector.units.second}
          toView={(v) => v / FPS}
          fromView={(v) => Math.round(v * FPS)}
          onCommit={(duration) => setAnim('animOut', { duration })}
        />
      </Section>
    </>
  );
}
