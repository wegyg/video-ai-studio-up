/** 속성 패널: 도형 모양·색·크기·테두리 (R18) */
import { ko } from '../i18n/ko';
import type { Clip, ShapeClip, ShapeKind } from '../model/types';
import { useProject } from '../store/project';
import { ColorField, NumberField, SelectField, SliderField } from './fields';

export function ShapeProps({ clip }: { clip: ShapeClip }) {
  const set = (patch: Partial<ShapeClip>) =>
    useProject.getState().updateClip(clip.id, (c) => (c.type === 'shape' ? ({ ...c, ...patch } as Clip) : c));
  const options = (['rect', 'rounded', 'circle', 'triangle'] as ShapeKind[]).map((k) => ({ value: k, label: ko.shapes[k] }));
  return (
    <section className="flex flex-col gap-2 border-b border-neutral-800 px-3 py-3" data-testid="shape-props">
      <h3 className="text-xs font-bold text-neutral-300">{ko.inspector.shape.title}</h3>
      <SelectField<ShapeKind> label={ko.inspector.shape.kind} testId="shape-kind" value={clip.shape} options={options} onCommit={(shape) => set({ shape })} />
      <ColorField label={ko.inspector.shape.fill} testId="shape-fill" value={clip.fill} onCommit={(fill) => set({ fill })} />
      <NumberField label={ko.inspector.shape.width} testId="shape-width" value={clip.width} min={10} max={4000} onCommit={(width) => set({ width })} />
      <NumberField label={ko.inspector.shape.height} testId="shape-height" value={clip.height} min={10} max={4000} onCommit={(height) => set({ height })} />
      <SliderField label={ko.inspector.shape.strokeWidth} testId="shape-stroke-width" value={clip.strokeWidth} min={0} max={40} onCommit={(strokeWidth) => set({ strokeWidth })} />
      {clip.strokeWidth > 0 && (
        <ColorField label={ko.inspector.shape.strokeColor} testId="shape-stroke-color" value={clip.strokeColor} onCommit={(strokeColor) => set({ strokeColor })} />
      )}
    </section>
  );
}
