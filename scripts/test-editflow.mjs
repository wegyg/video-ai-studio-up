/** E2E test of the two-step edit flow: /api/plan -> edit -> /api/render -> poll. */
import fs from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:3000";

async function main() {
  // 1) get an editable plan
  const fd = new FormData();
  fd.append("brief", "여름 세일 홍보 편집 테스트");
  fd.append("ratio", "9:16");
  fd.append("duration", "18");
  console.log("POST /api/plan …");
  const pr = await fetch(`${BASE}/api/plan`, { method: "POST", body: fd });
  if (!pr.ok) throw new Error("plan failed: " + pr.status + " " + (await pr.text()));
  const { planId, plan, ok } = await pr.json();
  console.log("  planId:", planId, "scenes:", plan.timeline.length, "validator ok:", ok);

  // 2) EDIT: rename first caption, drop the 2nd scene, change a motion
  plan.timeline[0].subtitle = "편집된 훅 문구예요?";
  plan.timeline[0].subtitle_emphasis = "편집된";
  plan.timeline.splice(1, 1); // remove scene 2
  plan.timeline[1].motion = { type: "zoom_punch", params: {} };
  // retime (server re-parses; but keep durations sane)
  let t = 0;
  for (const s of plan.timeline) {
    const dur = Math.max(1, s.end - s.start);
    s.start = Math.round(t * 100) / 100;
    s.end = Math.round((t + dur) * 100) / 100;
    t = s.end;
  }
  plan.format.duration_sec = plan.timeline[plan.timeline.length - 1].end;
  plan.cta.start = plan.timeline[plan.timeline.length - 1].start;
  console.log("  edited -> scenes:", plan.timeline.length, "duration:", plan.format.duration_sec);

  // 3) render the edited plan
  console.log("POST /api/render …");
  const rr = await fetch(`${BASE}/api/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId, plan }),
  });
  if (!rr.ok) throw new Error("render failed: " + rr.status + " " + (await rr.text()));
  const { id } = await rr.json();
  console.log("  job id:", id);

  let last = "";
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const jr = await fetch(`${BASE}/api/jobs/${id}`, { cache: "no-store" });
    const job = await jr.json();
    if (job.message !== last) {
      console.log(`  [${job.status}] ${job.progress}% ${job.message}`);
      last = job.message;
    }
    if (job.status === "done") {
      const vr = await fetch(`${BASE}${job.videoUrl}`);
      const buf = Buffer.from(await vr.arrayBuffer());
      fs.mkdirSync("out", { recursive: true });
      fs.writeFileSync("out/editflow-result.mp4", buf);
      console.log(`✅ edited render downloaded: ${(buf.length / 1024).toFixed(1)} KB, scenes=${job.planSummary?.scenes}, dur=${job.planSummary?.duration}s`);
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
