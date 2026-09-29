/**
 * 가져올 파일 검사 (R4.1, R4.4): 형식 확인 → Mediabunny로 메타데이터 읽기 → 이 브라우저에서 디코딩 가능한지 확인.
 * 실패하면 한국어 이유가 담긴 ImportError를 던진다.
 */
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { ko } from '../i18n/ko';
import { secondsToFrames } from '../model/time';
import type { AssetKind } from '../model/types';

const EXT_KIND: Record<string, AssetKind> = {
  mp4: 'video',
  mov: 'video',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  mp3: 'audio',
  wav: 'audio',
};

export const ACCEPT = Object.keys(EXT_KIND)
  .map((e) => `.${e}`)
  .join(',');
export const ACCEPT_AUDIO = '.mp3,.wav';

export class ImportError extends Error {}

export function kindOf(file: File): AssetKind | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_KIND[ext] ?? null;
}

export interface ProbeResult {
  kind: AssetKind;
  durationFrames?: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  /** 가져오기는 되지만 알려 줄 것 (예: 소리를 읽을 수 없음) */
  warning?: string;
}

const CODEC_NAMES: Record<string, string> = { avc: 'H.264', hevc: 'HEVC(H.265)', vp8: 'VP8', vp9: 'VP9', av1: 'AV1', prores: 'ProRes' };

async function probeImage(file: File): Promise<ProbeResult> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new ImportError(ko.importErrors.unreadable);
  }
  const r = { kind: 'image' as const, width: bmp.width, height: bmp.height, hasAudio: false };
  bmp.close();
  return r;
}

async function probeAv(file: File, kind: 'video' | 'audio'): Promise<ProbeResult> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    try {
      if (!(await input.canRead())) throw new Error();
    } catch {
      throw new ImportError(ko.importErrors.unreadable);
    }
    const at = await input.getPrimaryAudioTrack();
    const audioOk = at ? await at.canDecode() : false;
    if (kind === 'audio') {
      if (!at) throw new ImportError(ko.importErrors.noAudioTrack);
      if (!audioOk) throw new ImportError(ko.importErrors.audioCodec);
      return { kind, durationFrames: secondsToFrames(await input.computeDuration()), hasAudio: true };
    }
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new ImportError(ko.importErrors.noVideoTrack);
    if (!(await vt.canDecode())) {
      const codec = await vt.getCodec();
      throw new ImportError(ko.importErrors.videoCodec(codec ? (CODEC_NAMES[codec] ?? codec) : ko.importErrors.unknownCodec));
    }
    return {
      kind,
      durationFrames: Math.max(1, secondsToFrames(await input.computeDuration())),
      width: await vt.getDisplayWidth(),
      height: await vt.getDisplayHeight(),
      hasAudio: audioOk,
      warning: at && !audioOk ? ko.importErrors.audioInVideoUnreadable : undefined,
    };
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(ko.importErrors.unreadable);
  } finally {
    input.dispose();
  }
}

export async function probeFile(file: File): Promise<ProbeResult> {
  const kind = kindOf(file);
  if (!kind) throw new ImportError(ko.importErrors.unsupportedType);
  if (file.size === 0) throw new ImportError(ko.importErrors.empty);
  return kind === 'image' ? probeImage(file) : probeAv(file, kind);
}
