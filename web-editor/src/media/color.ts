/**
 * 색 정보가 없는(또는 일부만 있는) 영상을 내보내기 디코더가 미리보기와 같은 색으로 풀게 한다.
 *
 * 미리보기는 Chrome의 <video>가 푼 그림이다. Chrome은 원본에 색 정보(primaries·transfer·matrix)가
 * 셋 다 있지 않으면 전부 버리고 세로 해상도로 가정한다: 720 미만은 BT.601, 720 이상은 BT.709
 * (Chromium media/ffmpeg/ffmpeg_common.cc AVStreamToVideoDecoderConfig — VP9·AV1은 가정하지 않음).
 * 내보내기가 쓰는 Mediabunny(1.60)는 빈 칸을 모두 BT.709로 채운다(media-sink.js VideoDecoderWrapper).
 * 그래서 색 정보 없는 SD 영상(예: 640x360)은 내보내면 색이 달라졌다(평균 8/255 차이, docs/perf.md).
 *
 * 디코더 설정의 색 공간을 Chrome이 <video>에 주는 값과 똑같이 넣어 두면, 두 길이 같은 설정으로
 * 같은 디코더를 쓰게 되어 플랫폼(Windows 하드웨어 디코더 포함)과 상관없이 같은 색이 나온다.
 */
import type { InputVideoTrack } from 'mediabunny';

const REC601: VideoColorSpaceInit = { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false };
const REC709: VideoColorSpaceInit = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };

/**
 * Chrome <video>가 이 영상에 쓰는 색 공간. 원본 값을 그대로 두면 되는 경우는 null.
 * @param codec Mediabunny 코덱 이름 ('avc' | 'hevc' | 'vp8' | 'vp9' | 'av1' …)
 * @param naturalHeight 화소 비율을 반영한 회전 전 세로 크기 (Chrome의 natural_size.height())
 */
export function previewColorSpace(
  codec: string | null,
  colorSpace: VideoColorSpaceInit | undefined,
  naturalHeight: number,
): VideoColorSpaceInit | null {
  if (colorSpace?.primaries && colorSpace.transfer && colorSpace.matrix) return null; // 원본에 다 있음: 두 길 모두 그대로 씀
  if (codec === 'vp9' || codec === 'av1') return null; // Chrome도 추정하지 않는다
  return naturalHeight < 720 ? REC601 : REC709;
}

/**
 * 이 트랙으로 만드는 CanvasSink/VideoSampleSink가 미리보기와 같은 색으로 풀도록 디코더 설정을 고친다.
 * Mediabunny 1.60의 VideoSampleSink는 디코더를 만들 때 track.getDecoderConfig()를 부르므로,
 * 그 트랙 객체의 getDecoderConfig만 바꾼다(라이브러리 파일은 건드리지 않는다).
 * @returns 바꿔 넣은 색 공간 (바꾸지 않았으면 null)
 */
export async function matchPreviewColor(track: InputVideoTrack): Promise<VideoColorSpaceInit | null> {
  const config = await track.getDecoderConfig();
  if (!config) return null;
  const cs = previewColorSpace(await track.getCodec(), config.colorSpace, await track.getSquarePixelHeight());
  if (!cs) return null;
  const patched: VideoDecoderConfig = { ...config, colorSpace: cs };
  track.getDecoderConfig = async () => patched;
  return cs;
}
