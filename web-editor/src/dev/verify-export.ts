/**
 * 내보낸 MP4를 다시 읽어 픽셀과 정보를 꺼낸다 (완료 기준 G3 검증용).
 * 테스트에서만 쓰는 코드라 따로 묶여 필요할 때만 불러온다.
 */
import { ALL_FORMATS, BufferSource as MbBufferSource, CanvasSink, EncodedPacketSink, Input } from 'mediabunny';

export interface ExportedInfo {
  videoCodec: string | null;
  audioCodec: string | null;
  width: number;
  height: number;
  duration: number;
  /** 영상 트랙만의 길이 (AAC 패딩 때문에 전체 길이와 다를 수 있다) */
  videoDuration: number;
  frameCount: number;
  frameRate: number;
}

/** 요청한 시간(초)들에서 고른 좌표의 픽셀을 뽑는다. points는 0~1 비율. */
export async function exportedPixels(
  buffer: ArrayBuffer,
  times: number[],
  points: [number, number][],
): Promise<{ info: ExportedInfo; frames: { time: number; pixels: number[][] }[] }> {
  const input = new Input({ formats: ALL_FORMATS, source: new MbBufferSource(buffer) });
  try {
    const vt = await input.getPrimaryVideoTrack();
    const at = await input.getPrimaryAudioTrack();
    if (!vt) throw new Error('영상 트랙 없음');
    const width = await vt.getDisplayWidth();
    const height = await vt.getDisplayHeight();
    // 프레임 수는 실제 패킷을 세어 확인한다 (계산값이 아니라 파일에 든 수)
    const packetSink = new EncodedPacketSink(vt);
    let frameCount = 0;
    let packet = await packetSink.getFirstPacket({ metadataOnly: true });
    while (packet) {
      frameCount++;
      packet = await packetSink.getNextPacket(packet, { metadataOnly: true });
    }
    const info: ExportedInfo = {
      videoCodec: await vt.getCodec(),
      audioCodec: at ? await at.getCodec() : null,
      width,
      height,
      duration: await input.computeDuration(),
      videoDuration: await vt.computeDuration(),
      frameCount,
      frameRate: (await vt.computeFrameRateMetrics()).bestGuessFrameRate,
    };

    const sink = new CanvasSink(vt, { poolSize: 1 });
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const frames: { time: number; pixels: number[][] }[] = [];
    for (const time of times) {
      const wrapped = await sink.getCanvas(time);
      if (!wrapped) {
        frames.push({ time, pixels: [] });
        continue;
      }
      ctx.drawImage(wrapped.canvas, 0, 0);
      const pixels = points.map(([fx, fy]) => {
        const x = Math.min(width - 1, Math.max(0, Math.floor(width * fx)));
        const y = Math.min(height - 1, Math.max(0, Math.floor(height * fy)));
        const d = ctx.getImageData(x, y, 1, 1).data;
        return [d[0], d[1], d[2]];
      });
      frames.push({ time, pixels });
    }
    return { info, frames };
  } finally {
    input.dispose();
  }
}
