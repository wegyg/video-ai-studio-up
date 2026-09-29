/**
 * 단축키 (R9). e.key 대신 e.code(물리 키)를 쓴다.
 * 한글 입력기가 켜져 있으면 S 키의 e.key가 'ㄴ'이 되기 때문이다.
 * 글자 입력 칸에 포커스가 있으면 동작하지 않는다 (R9.2).
 */
import { actions } from './actions';

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset']);

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName === 'INPUT') return !NON_TEXT_INPUTS.has((target as HTMLInputElement).type);
  return false;
}

const isRange = (t: EventTarget | null) => t instanceof HTMLInputElement && t.type === 'range';

function onKeyDown(e: KeyboardEvent): void {
  if (e.isComposing || isTypingTarget(e.target)) return;
  const mod = e.ctrlKey || e.metaKey;
  let handled = true;
  switch (e.code) {
    case 'Space':
      if (!mod && !e.repeat) actions.togglePlay();
      break;
    case 'KeyS':
      if (mod) handled = false;
      else if (!e.repeat) actions.splitAtPlayhead();
      break;
    case 'Delete':
    case 'Backspace':
      if (mod) handled = false;
      else if (!e.repeat) actions.deleteSelected();
      break;
    case 'KeyZ':
      if (!mod) handled = false;
      else if (e.shiftKey) actions.redo();
      else actions.undo();
      break;
    case 'KeyY':
      if (!mod) handled = false;
      else actions.redo();
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
      // 줌 슬라이더에 포커스가 있으면 화살표는 슬라이더가 쓴다
      if (mod || isRange(e.target)) handled = false;
      else actions.stepFrames(e.code === 'ArrowLeft' ? -1 : 1);
      break;
    default:
      handled = false;
  }
  if (handled) e.preventDefault();
}

/** 버튼에 포커스가 있을 때 스페이스바가 버튼을 한 번 더 누르지 않게 한다 */
function onKeyUp(e: KeyboardEvent): void {
  if (e.code === 'Space' && !isTypingTarget(e.target)) e.preventDefault();
}

export function installShortcuts(): () => void {
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', onKeyUp, { capture: true });
  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('keyup', onKeyUp, { capture: true });
  };
}
