/**
 * 프로젝트를 JSON 파일로 내보내고 가져오기 (R10.4).
 * 미디어 원본은 넣지 않는다(파일이 너무 커진다). 대신 미디어 목록(이름·크기·길이)만 담고,
 * 가져온 뒤 원본이 없으면 "미디어 다시 연결"로 사용자가 파일을 골라 붙인다.
 */
import type { AssetMeta } from '../model/types';
import { snapshot, type SavedProject } from './persist';

export const JSON_FORMAT = 'web-editor-project';

export interface ProjectFile {
  format: typeof JSON_FORMAT;
  version: 1;
  savedAt: string;
  project: SavedProject['project'];
  view: SavedProject['view'];
}

export class ProjectFileError extends Error {}

export function toProjectFile(): ProjectFile {
  const s = snapshot();
  return { format: JSON_FORMAT, version: 1, savedAt: new Date().toISOString(), project: s.project, view: s.view };
}

/** 파일 이름에 쓸 수 없는 글자를 바꾼다 */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned || 'project';
}

export function downloadProjectJson(): string {
  const file = toProjectFile();
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fileName = `${safeFileName(file.project.name)}.json`;
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return fileName;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** 읽은 내용이 우리 형식인지 확인한다. 아니면 이유를 담아 던진다. */
export function parseProjectFile(text: string): ProjectFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProjectFileError('json');
  }
  if (!isObj(data) || data.format !== JSON_FORMAT) throw new ProjectFileError('format');
  if (data.version !== 1) throw new ProjectFileError('version');
  const project = data.project;
  if (!isObj(project) || typeof project.id !== 'string' || !isObj(project.edit) || !Array.isArray((project.edit as Record<string, unknown>).tracks)) {
    throw new ProjectFileError('broken');
  }
  const assets = isObj(project.assets) ? (project.assets as Record<string, AssetMeta>) : {};
  const view = isObj(data.view) ? (data.view as ProjectFile['view']) : { playhead: 0, pxPerFrame: 2, snap: true, safeArea: false };
  return {
    format: JSON_FORMAT,
    version: 1,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : '',
    project: { ...(project as unknown as SavedProject['project']), assets },
    view,
  };
}

export function toSavedProject(file: ProjectFile): SavedProject {
  return { version: 1, project: file.project, view: file.view, updatedAt: Date.now() };
}
