/**
 * 테스트용 미디어 파일 생성 스크립트 (개발자용).
 * 만든 파일은 tests/fixtures/에 커밋되어 있으므로 테스트 실행에는 필요 없다.
 *
 * ffmpeg 경로: 환경 변수 FFMPEG_PATH, 없으면 PATH의 `ffmpeg`.
 * 사용: FFMPEG_PATH=/path/to/ffmpeg npm run fixtures
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
mkdirSync(outDir, { recursive: true });

function run(name, args) {
  const out = join(outDir, name);
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args, out], { stdio: 'inherit' });
  console.log(`${name}  ${statSync(out).size} bytes`);
}

// 1) 색 단계 영상 (9:16, 540x960, 30fps, 4초): 0-1초 빨강, 1-2초 초록, 2-3초 파랑, 3-4초 노랑.
//    프레임 정확도 테스트용. 1초마다 키프레임. 오디오는 440Hz 스테레오 AAC.
run('color-steps.mp4', [
  '-f', 'lavfi', '-i', 'color=c=0xFF0000:s=540x960:r=30:d=1',
  '-f', 'lavfi', '-i', 'color=c=0x00FF00:s=540x960:r=30:d=1',
  '-f', 'lavfi', '-i', 'color=c=0x0000FF:s=540x960:r=30:d=1',
  '-f', 'lavfi', '-i', 'color=c=0xFFFF00:s=540x960:r=30:d=1',
  '-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*440*t)':s=48000:d=4",
  '-filter_complex', '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v];[4:a]pan=stereo|c0=c0|c1=c0[a]',
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', '30', '-crf', '12',
  '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
]);

// 2) QuickTime .mov (16:9, 640x360, 30fps, 3초), 움직이는 테스트 패턴 + 330Hz 오디오.
run('pattern.mov', [
  '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=3',
  '-f', 'lavfi', '-i', "aevalsrc='0.4*sin(2*PI*330*t)':s=48000:d=3",
  '-filter_complex', '[1:a]pan=stereo|c0=c0|c1=c0[a]',
  '-map', '0:v', '-map', '[a]',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '30', '-crf', '23',
  '-c:a', 'aac', '-b:a', '96k',
]);

// 2-1) HEVC(H.265) mp4 — 아이폰 영상처럼 브라우저가 디코딩하지 못할 수 있는 코덱 (거부 메시지 테스트용)
run('hevc.mp4', [
  '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=1',
  '-c:v', 'libx265', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-x265-params', 'log-level=error',
]);

// 3) 이미지: PNG 400x400 청록, JPG 600x400 주황.
run('image.png', ['-f', 'lavfi', '-i', 'color=c=0x00FFFF:s=400x400', '-frames:v', '1']);
run('image.jpg', ['-f', 'lavfi', '-i', 'color=c=0xFF8800:s=600x400', '-frames:v', '1', '-q:v', '3']);

// 4) 오디오: MP3 5초(음량이 오르내려 파형이 보이게), WAV 3초.
run('audio.mp3', [
  '-f', 'lavfi', '-i', "aevalsrc='sin(2*PI*440*t)*(0.2+0.8*abs(sin(PI*t)))':s=44100:d=5",
  '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '128k',
]);
run('audio.wav', [
  '-f', 'lavfi', '-i', "aevalsrc='0.6*sin(2*PI*660*t)*(0.3+0.7*abs(sin(2*PI*t)))':s=48000:d=3",
  '-ac', '2', '-c:a', 'pcm_s16le',
]);
