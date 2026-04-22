import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAiGateway } from "ai-gateway-provider";
import { streamText, stepCountIs } from "ai";
import type { AppContext } from "../env";
import { AGENTS, type AgentId, AGENT_LIST } from "../ai/agents";
import { buildAgentTools } from "../ai/tools";

export const chatRoutes = new Hono<AppContext>();

// Public agent roster, consumed by the client to populate the buddy list.
chatRoutes.get("/agents", (c) =>
  c.json(
    AGENT_LIST.map((a) => ({
      id: a.id,
      displayName: a.displayName,
      screenName: a.screenName,
      avatar: a.avatar,
      status: a.status,
      tagline: a.tagline,
    })),
  ),
);

type IncomingMessage = { role: "user" | "assistant"; content: string };

// Stream a Claude response for an agent. SSE with raw token text events so the
// client can append tokens into a Jazz Message CoMap as they arrive -> all
// connected tabs see the reply stream in real time.
chatRoutes.post("/:agentId/stream", async (c) => {
  const agentId = c.req.param("agentId") as AgentId;
  const agent = AGENTS[agentId];
  if (!agent) return c.json({ error: "unknown_agent" }, 404);

  const body = await c.req.json<{
    messages: IncomingMessage[];
    nowPlaying?: { title: string; artist: string } | null;
  }>();

  // Route through Cloudflare AI Gateway (observability + caching + failover)
  // when configured. Otherwise go direct to Anthropic.
  const useGateway =
    !!c.env.AI_GATEWAY_ID && !!c.env.CF_ACCOUNT_ID && !!c.env.CF_AIG_TOKEN;
  const anthropicDirect = createAnthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  const model = useGateway
    ? createAiGateway({
        accountId: c.env.CF_ACCOUNT_ID!,
        gateway: c.env.AI_GATEWAY_ID!,
        apiKey: c.env.CF_AIG_TOKEN!,
      })(anthropicDirect("claude-sonnet-4-5"))
    : anthropicDirect("claude-sonnet-4-5");

  let system = agent.systemPrompt;
  if (body.nowPlaying) {
    system += `\n\n[context] The user is currently listening to "${body.nowPlaying.title}" by ${body.nowPlaying.artist} in XP Tunes. You may reference this naturally if it fits.`;
  }

  return streamSSE(c, async (stream) => {
    try {
      const result = streamText({
        model,
        system,
        messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
        tools: buildAgentTools(c.env),
        stopWhen: stepCountIs(4),
      });

      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          await stream.writeSSE({ event: "token", data: part.text });
        } else if (part.type === "tool-call") {
          await stream.writeSSE({
            event: "tool-call",
            data: JSON.stringify({ name: part.toolName, input: part.input }),
          });
        } else if (part.type === "tool-result") {
          await stream.writeSSE({
            event: "tool-result",
            data: JSON.stringify({ name: part.toolName, output: part.output }),
          });
        } else if (part.type === "error") {
          await stream.writeSSE({
            event: "error",
            data: String(part.error),
          });
        }
      }
      await stream.writeSSE({ event: "done", data: "" });
    } catch (err) {
      await stream.writeSSE({ event: "error", data: String(err) });
    }
  });
});
