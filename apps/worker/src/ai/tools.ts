import { tool } from "ai";
import { z } from "zod";
import Mux from "@mux/mux-node";
import type { Env } from "../env";

/**
 * AI SDK tools for MSN agents.
 * `watchVideo` is the hero: it ingests a video URL into Mux and runs Mux Robots
 * jobs to actually analyze the content, then returns structured data the agent
 * can react to in-character.
 */
export function buildAgentTools(env: Env) {
  const mux = new Mux({ tokenId: env.MUX_TOKEN_ID, tokenSecret: env.MUX_TOKEN_SECRET });

  const muxFetch = (path: string, init?: RequestInit) =>
    fetch(`https://api.mux.com${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(`${env.MUX_TOKEN_ID}:${env.MUX_TOKEN_SECRET}`)}`,
        ...(init?.headers ?? {}),
      },
    });

  async function waitForAsset(assetId: string, timeoutMs = 120_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const asset = await mux.video.assets.retrieve(assetId);
      if (asset.status === "ready") return asset;
      if (asset.status === "errored") throw new Error("Mux asset errored");
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Mux asset timed out");
  }

  /** Poll a Mux Robots job until it's done.
   *  Per docs: statuses are "pending" | "completed" | "errored".
   *  Retrieve endpoint: GET /robots/v0/jobs/{workflow}/{JOB_ID} */
  async function pollJob(
    fetcher: typeof muxFetch,
    workflow: string,
    jobId: string | undefined,
    timeoutMs: number,
  ): Promise<any> {
    if (!jobId) return null;
    const start = Date.now();
    let lastJob: any = null;
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetcher(`/robots/v0/jobs/${workflow}/${jobId}`);
        if (res.ok) {
          const job: any = await res.json();
          lastJob = job?.data;
          const status = job?.data?.status;
          if (status === "completed" || status === "errored") {
            return job?.data;
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 2000));
    }
    return lastJob;
  }

  return {
    watchVideo: tool({
      description:
        "Actually watch a video the user shared. Accepts either: (a) a Mux stream URL like https://stream.mux.com/<PLAYBACK_ID>.m3u8, (b) a bare Mux playback ID (long alphanumeric string, 30+ chars, no spaces/dots/slashes), or (c) any other public video URL (mp4, etc). Uses Mux Robots AI to summarize, find key moments, and answer questions. ALWAYS call this when the user pastes a Mux playback ID or any video URL — do not try to guess the content yourself.",
      inputSchema: z.object({
        url: z
          .string()
          .min(10)
          .describe(
            "The video URL, Mux stream URL, or bare Mux playback ID the user pasted",
          ),
        questions: z
          .array(z.string())
          .max(3)
          .optional()
          .describe("Up to 3 specific questions to ask about the video"),
      }),
      execute: async ({ url, questions }) => {
        try {
          // 0. If the input is either a Mux stream URL or a bare playback ID,
          //    skip re-ingestion and run Robots directly on the existing asset.
          const input = url.trim();
          const streamUrlMatch = input.match(
            /stream\.mux\.com\/([a-zA-Z0-9]+)(?:\.|\/)/,
          );
          const barePlaybackIdMatch = /^[a-zA-Z0-9]{30,}$/.test(input)
            ? [input, input]
            : null;
          const muxPlaybackMatch = streamUrlMatch ?? barePlaybackIdMatch;

          let ready: any;
          if (muxPlaybackMatch) {
            const id = muxPlaybackMatch[1]!;
            // Try it as a playback id first; if that fails, assume it's an asset id.
            let assetId: string | null = null;
            try {
              const pb = await mux.video.playbackIds.retrieve(id);
              assetId = (pb as any)?.object?.id ?? null;
            } catch {
              assetId = null;
            }
            if (!assetId) {
              // Fall back: treat input as an asset id directly.
              try {
                const asset = await mux.video.assets.retrieve(id);
                if (asset?.id) assetId = asset.id;
              } catch {
                assetId = null;
              }
            }
            if (!assetId) {
              throw new Error(
                `Couldn't find a Mux asset for that id. Tried both as playback id and asset id.`,
              );
            }
            ready = await waitForAsset(assetId);
          } else {
            // 1. Create Mux asset + auto-generate captions so Robots jobs that
            //    need a caption track (find-key-moments, generate-chapters) work.
            const asset = await mux.video.assets.create({
              inputs: [{ url, generated_subtitles: [{ language_code: "en" }] }],
              playback_policies: ["public"],
              video_quality: "basic",
            });
            // 2. Wait for ready + storyboard
            ready = await waitForAsset(asset.id);
          }

          // 3. Kick off Robots jobs. These return job records, not finished work —
          //    we poll summarize until complete; the others we return as-is.
          const [summaryJob, keyMomentsJob, qnaJob] = await Promise.all([
            muxFetch("/robots/v0/jobs/summarize", {
              method: "POST",
              body: JSON.stringify({ parameters: { asset_id: ready.id } }),
            }).then((r) => r.json()),
            muxFetch("/robots/v0/jobs/find-key-moments", {
              method: "POST",
              body: JSON.stringify({ parameters: { asset_id: ready.id } }),
            })
              .then((r) => r.json())
              .catch(() => null),
            questions && questions.length
              ? muxFetch("/robots/v0/jobs/ask-questions", {
                  method: "POST",
                  body: JSON.stringify({
                    parameters: { asset_id: ready.id, questions },
                  }),
                }).then((r) => r.json())
              : Promise.resolve(null),
          ]);

          // Long videos take longer to summarize; scale timeout with duration
          const timeoutMs = Math.min(
            180_000,
            Math.max(60_000, (ready.duration ?? 60) * 500),
          );
          const summary = await pollJob(
            muxFetch,
            "summarize",
            (summaryJob as any)?.data?.id,
            timeoutMs,
          );
          const keyMoments = await pollJob(
            muxFetch,
            "find-key-moments",
            (keyMomentsJob as any)?.data?.id,
            timeoutMs,
          );

          // Mux Robots returns completed results in `data.outputs` (not `.result`).
          return {
            ok: true,
            muxAssetId: ready.id,
            muxPlaybackId: ready.playback_ids?.[0]?.id ?? null,
            durationSec: ready.duration,
            summary: summary?.outputs ?? null,
            summaryStatus: summary?.status ?? "unknown",
            keyMoments: keyMoments?.outputs ?? null,
            keyMomentsStatus: keyMoments?.status ?? "unknown",
            questions: qnaJob,
          };
        } catch (err) {
          return { ok: false, error: String(err) };
        }
      },
    }),

    findKeyMoments: tool({
      description:
        "Given a Mux asset ID (from a previous watchVideo call), re-run the find-key-moments Robots job. Use only if the user asks for highlights or specific timestamps.",
      inputSchema: z.object({ muxAssetId: z.string() }),
      execute: async ({ muxAssetId }) => {
        const res = await muxFetch("/robots/v0/jobs/find-key-moments", {
          method: "POST",
          body: JSON.stringify({ parameters: { asset_id: muxAssetId } }),
        });
        return res.json();
      },
    }),
  };
}
