/**
 * End-to-end HTTP test against the running Next.js server.
 * Uploads a brief (+ optional clip), polls the job, downloads the MP4.
 */
import fs from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:3000";

async function main() {
  // build a small test clip if ffmpeg is around (optional footage)
  const clipPath = "tmp/http-clip.mp4";
  fs.mkdirSync("tmp", { recursive: true });

  const fd = new FormData();
  fd.append("brief", "여름 세일 홍보 HTTP 테스트");
  fd.append("ratio", "9:16");
  fd.append("duration", "16");
  if (fs.existsSync(clipPath)) {
    fd.append("videos", new Blob([fs.readFileSync(clipPath)], { type: "video/mp4" }), "clip.mp4");
    console.log("attached test clip");
  }

  console.log("POST /api/generate …");
  const r = await fetch(`${BASE}/api/generate`, { method: "POST", body: fd });
  if (!r.ok) throw new Error("generate failed: " + r.status + " " + (await r.text()));
  const { id } = await r.json();
  console.log("job id:", id);

  let last = "";
  for (let i = 0; i < 120; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    const jr = await fetch(`${BASE}/api/jobs/${id}`, { cache: "no-store" });
    const job = await jr.json();
    if (job.message !== last) {
      console.log(`  [${job.status}] ${job.progress}% ${job.message}`);
      last = job.message;
    }
    if (job.status === "done") {
      const vr = await fetch(`${BASE}${job.videoUrl}`);
      const buf = Buffer.from(await vr.arrayBuffer());
      fs.writeFileSync("out/http-result.mp4", buf);
      console.log(`✅ downloaded ${(buf.length / 1024).toFixed(1)} KB -> out/http-result.mp4`);
      console.log("   contentType:", vr.headers.get("content-type"));
      return;
    }
    if (job.status === "error") throw new Error("job error: " + job.error);
  }
  throw new Error("timed out");
}

main().catch((e) => {
  console.error("TEST FAILED:", e.message);
  process.exit(1);
});
