/**
 * Cloudflare Worker bindings and secrets.
 * Mirrors wrangler.toml + `wrangler secret` entries.
 */
export type Env = {
  // Bindings
  ASSETS: Fetcher;
  CACHE: KVNamespace;

  // Vars
  PUBLIC_APP_URL: string;

  // Secrets
  ANTHROPIC_API_KEY: string;
  MUX_TOKEN_ID: string;
  MUX_TOKEN_SECRET: string;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  JAZZ_API_KEY: string;

  // Optional: CF AI Gateway routing (observability + caching + failover).
  AI_GATEWAY_ID?: string;         // gateway slug, e.g. "default"
  CF_ACCOUNT_ID?: string;         // your CF account id
  CF_AIG_TOKEN?: string;          // CF user API token with AI Gateway access
};

export type AppContext = { Bindings: Env };
