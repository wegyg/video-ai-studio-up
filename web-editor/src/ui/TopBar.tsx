import { actions } from '../actions';
import { ko, withKey } from '../i18n/ko';
import { useCanRedo, useCanUndo } from '../store/history';
import { useProject } from '../store/project';
import { IconButton } from './common';
import { IconRedo, IconUndo } from './icons';
import { SaveIndicator } from './SaveIndicator';

export function TopBar() {
  const name = useProject((s) => s.name);
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-3">
      <span className="text-sm font-bold text-cyan-400">{ko.app.title}</span>
      <input
        aria-label={ko.topbar.projectName}
        value={name}
        onChange={(e) => useProject.getState().setName(e.target.value)}
        className="h-7 w-64 rounded border border-transparent bg-transparent px-2 text-sm text-neutral-200 hover:border-neutral-700 focus:border-cyan-600 focus:outline-none"
      />
      <div className="flex-1" />
      <SaveIndicator />
      <div className="mx-1 h-5 w-px bg-neutral-800" />
      <IconButton label={ko.topbar.undo} tooltip={withKey(ko.topbar.undo, ko.keys.undo)} disabled={!canUndo} onClick={actions.undo} testId="undo">
        <IconUndo />
      </IconButton>
      <IconButton label={ko.topbar.redo} tooltip={withKey(ko.topbar.redo, ko.keys.redo)} disabled={!canRedo} onClick={actions.redo} testId="redo">
        <IconRedo />
      </IconButton>
    </header>
  );
}
