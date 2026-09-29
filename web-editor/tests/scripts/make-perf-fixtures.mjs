/**
 * 성능 측정용 큰 파일 만들기 (수용 기준 A1·A2).
 * 1080×1920 30fps 12초 클립 5개 = 60초 프로젝트. 파일이 커서 저장소에 넣지 않고 그때그때 만든다.
 *
 * 사용: node tests/scripts/make-perf-fixtures.mjs [출력폴더]
 * ffmpeg 경로: FFMPEG_PATH 또는 PATH의 ffmpeg.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const outDir = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.perf-fixtures'));
const COUNT = 5;
const SECONDS = 12;

mkdirSync(outDir, { recursive: true });
const first = join(outDir, 'clip1.mp4');

if (existsSync(first)) {
  console.log(`이미 있음: ${outDir}`);
} else {
  // 움직이는 무늬 + 소리. 실제 촬영본처럼 매 프레임이 달라 디코딩 부담이 있다.
  execFileSync(
    ffmpeg,
    [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `testsrc2=s=1080x1920:r=30:d=${SECONDS}`,
      '-f', 'lavfi', '-i', `sine=frequency=500:sample_rate=48000:duration=${SECONDS}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '60', '-b:v', '8M',
      '-c:a', 'aac', '-ac', '2',
      first,
    ],
    { stdio: 'inherit' },
  );
  for (let i = 2; i <= COUNT; i++) copyFileSync(first, join(outDir, `clip${i}.mp4`));
}

for (let i = 1; i <= COUNT; i++) {
  const p = join(outDir, `clip${i}.mp4`);
  console.log(`${p}  ${(statSync(p).size / 1e6).toFixed(1)}MB`);
}
console.log(`PERF_DIR=${outDir}`);
