import { Hono } from "hono";
import Mux from "@mux/mux-node";
import type { AppContext } from "../env";

export const muxRoutes = new Hono<AppContext>();

function getMux(env: AppContext["Bindings"]) {
  return new Mux({ tokenId: env.MUX_TOKEN_ID, tokenSecret: env.MUX_TOKEN_SECRET });
}

// Create a Mux asset from a video URL (used by the MSN agent `watchVideo` tool
// and by the visualizer ingest script).
// Direct upload: client POSTs here to get a one-time Mux upload URL, then PUTs
// the file bytes directly to Mux. Bypasses Worker body size limits.
// Note: `generated_subtitles` can't be set via Upload settings — we generate
// them explicitly on the asset in /analyze once it's ready.
muxRoutes.post("/uploads", async (c) => {
  const mux = getMux(c.env);
  const upload = await mux.video.uploads.create({
    cors_origin: "*",
    new_asset_settings: {
      playback_policies: ["public"],
      video_quality: "basic",
    },
  });
  return c.json({ uploadId: upload.id, uploadUrl: upload.url });
});

// After upload, poll this to resolve the upload -> asset mapping.
muxRoutes.get("/uploads/:id", async (c) => {
  const mux = getMux(c.env);
  const upload = await mux.video.uploads.retrieve(c.req.param("id"));
  return c.json({
    uploadId: upload.id,
    status: upload.status,
    assetId: upload.asset_id ?? null,
  });
});

muxRoutes.post("/assets", async (c) => {
  const { url } = await c.req.json<{ url: string }>();
  if (!url) return c.json({ error: "missing_url" }, 400);

  const mux = getMux(c.env);
  const asset = await mux.video.assets.create({
    inputs: [{ url }],
    playback_policies: ["public"],
    video_quality: "basic",
  });

  return c.json({
    assetId: asset.id,
    status: asset.status,
    playbackId: asset.playback_ids?.[0]?.id ?? null,
  });
});

// Poll asset status — client/agent uses this to wait for `ready`.
muxRoutes.get("/assets/:id", async (c) => {
  const mux = getMux(c.env);
  const asset = await mux.video.assets.retrieve(c.req.param("id"));
  return c.json({
    assetId: asset.id,
    status: asset.status,
    playbackId: asset.playback_ids?.[0]?.id ?? null,
    duration: asset.duration,
    aspectRatio: asset.aspect_ratio,
  });
});

// Mux Robots — AI workflows on an existing asset.
// https://www.mux.com/blog/mux-robots
type RobotsJob =
  | "summarize"
  | "moderate"
  | "ask-questions"
  | "translate-captions"
  | "find-key-moments"
  | "generate-chapters";

async function callRobots(
  env: AppContext["Bindings"],
  job: RobotsJob,
  parameters: Record<string, unknown>,
) {
  const res = await fetch(`https://api.mux.com/robots/v0/jobs/${job}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${env.MUX_TOKEN_ID}:${env.MUX_TOKEN_SECRET}`)}`,
    },
    body: JSON.stringify({ parameters }),
  });
  if (!res.ok) {
    throw new Error(`Mux Robots ${job} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// One-shot: given a Mux asset id (from a direct upload), wait for ready then
// run summarize + find-key-moments. Used by the MSN chat's file-drop flow.
muxRoutes.post("/analyze/:assetId", async (c) => {
  const mux = getMux(c.env);
  const assetId = c.req.param("assetId");

  // 1. Wait for asset ready
  const start = Date.now();
  let asset = await mux.video.assets.retrieve(assetId);
  while (asset.status !== "ready" && Date.now() - start < 180_000) {
    if (asset.status === "errored") return c.json({ error: "asset errored" }, 500);
    await new Promise((r) => setTimeout(r, 2500));
    asset = await mux.video.assets.retrieve(assetId);
  }
  if (asset.status !== "ready") return c.json({ error: "timeout" }, 504);

  const playbackId = asset.playback_ids?.[0]?.id ?? null;

  // 2. Ensure a ready text track exists (Robots summarize/key-moments need it).
  //    For direct uploads we have to generate captions explicitly after the
  //    fact — can't set generated_subtitles on Upload settings.
  const tracks = (asset.tracks ?? []) as any[];
  const hasReadyText = tracks.some((t) => t.type === "text" && t.status === "ready");
  if (!hasReadyText) {
    const audioTrack = tracks.find((t) => t.type === "audio");
    if (audioTrack?.id) {
      try {
        await mux.video.assets.generateSubtitles(assetId, audioTrack.id, {
          generated_subtitles: [
            { language_code: "en", name: "English (generated)" },
          ],
        });
      } catch (err) {
        console.warn("generateSubtitles failed (continuing)", err);
      }
      // Poll the asset until a text track shows up and is `ready`.
      const capStart = Date.now();
      while (Date.now() - capStart < 180_000) {
        const a = await mux.video.assets.retrieve(assetId);
        const txt = (a.tracks ?? []).find(
          (t: any) => t.type === "text" && t.status === "ready",
        );
        if (txt) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  // 3. Fire robots jobs
  const [summaryJob, keyMomentsJob] = await Promise.all([
    callRobots(c.env, "summarize", { asset_id: assetId }).catch(() => null),
    callRobots(c.env, "find-key-moments", { asset_id: assetId }).catch(() => null),
  ]);

  // Poll summarize until completed. Per Mux Robots docs:
  //   GET /robots/v0/jobs/{workflow}/{JOB_ID}
  //   status ∈ { pending, completed, errored }
  const timeoutMs = Math.min(300_000, Math.max(60_000, (asset.duration ?? 60) * 1000));
  let summaryResult: any = null;
  let summaryStatus: string = "pending";
  const jobId = (summaryJob as any)?.data?.id;
  if (jobId) {
    const s = Date.now();
    while (Date.now() - s < timeoutMs) {
      const res = await fetch(
        `https://api.mux.com/robots/v0/jobs/summarize/${jobId}`,
        {
          headers: {
            Authorization: `Basic ${btoa(`${c.env.MUX_TOKEN_ID}:${c.env.MUX_TOKEN_SECRET}`)}`,
          },
        },
      );
      if (!res.ok) break;
      const job: any = await res.json();
      summaryStatus = job?.data?.status ?? summaryStatus;
      if (summaryStatus === "completed") {
        // Results live under `data.outputs`
        summaryResult = job?.data?.outputs ?? null;
        break;
      }
      if (summaryStatus === "errored") break;
      await new Promise((r) => setTimeout(r, 2500));
    }
  }

  return c.json({
    assetId,
    playbackId,
    durationSec: asset.duration,
    // Flattened so the client doesn't have to guess the shape.
    summary: summaryResult
      ? {
          status: "complete",
          title: summaryResult.title ?? null,
          description: summaryResult.description ?? null,
          tags: summaryResult.tags ?? [],
        }
      : { status: summaryStatus, title: null, description: null, tags: [] },
    keyMoments: keyMomentsJob,
  });
});

muxRoutes.post("/robots/:job", async (c) => {
  const job = c.req.param("job") as RobotsJob;
  const parameters = await c.req.json();
  try {
    const result = await callRobots(c.env, job, parameters);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// Visualizer lookup: given a Spotify track + mood, return a Mux playback ID.
// Cached per trackId in KV so repeat plays are instant.
muxRoutes.get("/visualizer", async (c) => {
  const trackId = c.req.query("trackId");
  const mood = c.req.query("mood") ?? "dreamy";
  if (!trackId) return c.json({ error: "missing_trackId" }, 400);

  const cacheKey = `viz:${trackId}`;
  const cached = await c.env.CACHE.get(cacheKey, "json");
  if (cached) return c.json(cached);

  // Pull mood-indexed visualizer library (populated by build-visualizer-library.ts)
  const library =
    (await c.env.CACHE.get<Record<string, { playbackId: string; mood: string }[]>>(
      "visualizer-library",
      "json",
    )) ?? {};
  const pool = library[mood] ?? Object.values(library).flat();
  if (!pool.length) {
    return c.json({ error: "no_visualizers_available" }, 503);
  }
  const pick = pool[Math.floor(Math.random() * pool.length)]!;
  await c.env.CACHE.put(cacheKey, JSON.stringify(pick), { expirationTtl: 60 * 60 * 24 });
  return c.json(pick);
});
