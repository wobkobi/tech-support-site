// src/shared/lib/ai/json-completion.ts
// One JSON-reply model call to OpenAI or Claude. AI_PROVIDER picks the provider ("openai" unless
// "anthropic"); AI_PROVIDER_<FEATURE> overrides per feature. ANTHROPIC_MODEL and ANTHROPIC_EFFORT
// tune Claude, so the eval harness can switch without code changes.

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

/** Claude model used when ANTHROPIC_MODEL isn't set. */
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";

/** Claude output room: it writes a little more than gpt-4.1 around the same JSON, and a cut reply fails to parse. */
const ANTHROPIC_MIN_MAX_TOKENS = 4000;

/** Output room when Claude thinks first: the thinking counts against max_tokens too. */
const ANTHROPIC_THINKING_MAX_TOKENS = 16_000;

type ClaudeEffort = NonNullable<Anthropic.OutputConfig["effort"]>;
const CLAUDE_EFFORTS: readonly ClaudeEffort[] = ["low", "medium", "high"];

/**
 * The ANTHROPIC_EFFORT setting, when it names a known level.
 * @returns The effort level, or null to answer without thinking.
 */
function claudeEffort(): ClaudeEffort | null {
  const value = process.env.ANTHROPIC_EFFORT as ClaudeEffort | undefined;
  return value && CLAUDE_EFFORTS.includes(value) ? value : null;
}

/** The AI features, each of which can run on its own provider. */
export type AiFeature =
  "parse-job" | "estimate" | "mailing-draft" | "post-draft" | "social-caption";

export interface JsonCompletionRequest {
  /** Which feature is calling, for its AI_PROVIDER_<FEATURE> override. */
  feature: AiFeature;
  /** OpenAI model, used when the provider is OpenAI. */
  openAiModel: string;
  /** System prompt sections in order. The first must be byte-identical across calls, so it caches. */
  system: string[];
  /** The user message. */
  user: string;
  /** Output token ceiling for OpenAI; Claude gets at least {@link ANTHROPIC_MIN_MAX_TOKENS}. */
  maxTokens: number;
  /** Sampling temperature for OpenAI. Current Claude models reject non-default values, so it isn't sent there. */
  temperature: number;
  /** Per-attempt timeout in milliseconds. */
  timeoutMs: number;
  /** SDK retries after the first attempt. */
  maxRetries: number;
  /** Caps the whole call, retries and retry-after sleeps included. */
  signal?: AbortSignal;
}

export interface JsonCompletionResult {
  /** The reply's JSON text, with any code fence stripped. */
  text: string;
  /** Which model answered, for logs. */
  model: string;
  /** Prompt tokens, how many of them came from cache, and output tokens. */
  usage: { input: number; cached: number; output: number };
}

/**
 * Whether a feature uses Claude: AI_PROVIDER_<FEATURE> wins, else AI_PROVIDER.
 * @param feature - The calling feature.
 * @returns True when the provider for that feature is "anthropic".
 */
export function usesAnthropic(feature: AiFeature): boolean {
  const own = process.env[`AI_PROVIDER_${feature.toUpperCase().replace(/-/g, "_")}`];
  return (own || process.env.AI_PROVIDER) === "anthropic";
}

/**
 * Names a feature's provider, model and effort, so cache keys never cross setups.
 * @param feature - The calling feature.
 * @returns "openai", or "anthropic:" plus the Claude model id and effort.
 */
export function aiProviderKey(feature: AiFeature): string {
  return usesAnthropic(feature)
    ? `anthropic:${process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL}:${claudeEffort() ?? "none"}`
    : "openai";
}

type AiProvider = "anthropic" | "openai";

/**
 * Whether a provider has its API key set.
 * @param provider - The provider.
 * @returns True when its key is present.
 */
function hasKey(provider: AiProvider): boolean {
  return Boolean(
    provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY,
  );
}

/**
 * Whether any AI provider key is set; one is enough, as calls fall back to the other.
 * @returns True when at least one key is present.
 */
export function aiConfigured(): boolean {
  return hasKey("anthropic") || hasKey("openai");
}

/**
 * Whether an error is a 429 rate limit from either SDK. OpenAI's used-up-quota 429 doesn't
 * count, since waiting never clears it.
 * @param err - The caught error.
 * @returns True for a rate-limit error from either SDK.
 */
export function isAiRateLimitError(err: unknown): err is { headers?: unknown } {
  if (err instanceof OpenAI.RateLimitError) return err.code !== "insufficient_quota";
  return err instanceof Anthropic.RateLimitError;
}

/**
 * Whether a failure should go once to the other provider: provider-side trouble (out of credit,
 * bad key, rate limit, unreachable, 5xx incl. 529). Not timeouts, aborts, bad requests or bad replies.
 * @param err - The caught error.
 * @returns True when the other provider should be tried.
 */
function shouldFallBack(err: unknown): boolean {
  if (err instanceof Anthropic.APIUserAbortError || err instanceof OpenAI.APIUserAbortError) {
    return false;
  }
  if (
    err instanceof Anthropic.APIConnectionTimeoutError ||
    err instanceof OpenAI.APIConnectionTimeoutError
  ) {
    return false;
  }
  if (err instanceof Anthropic.APIConnectionError || err instanceof OpenAI.APIConnectionError) {
    return true;
  }
  if (err instanceof Anthropic.APIError) {
    if (err.type === "billing_error" || /credit balance/i.test(err.message)) return true;
  } else if (!(err instanceof OpenAI.APIError)) {
    return false;
  }
  const status = err.status ?? 0;
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

/**
 * Pulls the JSON object out of a reply by its outermost braces, since Claude may wrap it in a
 * code fence or sentence.
 * @param text - Raw reply text.
 * @returns The JSON object text, or the input when no braces are found.
 */
export function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start !== -1 && end > start ? text.slice(start, end + 1) : text;
}

/**
 * Thinking setting per Claude model: adaptive at the given effort, or none where allowed
 * (Haiku 5.5 "disabled", Sonnet 5.5 "between_tools"); other models keep their default.
 * @param model - Claude model id.
 * @param effort - Effort level, or null for no thinking.
 * @returns The thinking parameter, or undefined to omit it.
 */
function claudeThinking(
  model: string,
  effort: ClaudeEffort | null,
): Anthropic.MessageCreateParams["thinking"] {
  if (effort) return { type: "adaptive" };
  if (model.startsWith("claude-haiku-5")) return { type: "disabled" };
  if (model.startsWith("claude-sonnet-5-5")) return { type: "between_tools" };
  return undefined;
}

/**
 * One call to Claude.
 * @param req - The request.
 * @returns The JSON text, the model and token usage.
 */
async function callAnthropic(req: JsonCompletionRequest): Promise<JsonCompletionResult> {
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    timeout: req.timeoutMs,
    maxRetries: req.maxRetries,
  });
  const effort = claudeEffort();
  const thinking = claudeThinking(model, effort);
  const message = await client.messages.create(
    {
      model,
      max_tokens: Math.max(
        req.maxTokens,
        effort ? ANTHROPIC_THINKING_MAX_TOKENS : ANTHROPIC_MIN_MAX_TOKENS,
      ),
      ...(thinking && { thinking }),
      ...(effort && { output_config: { effort } }),
      // Cache breakpoint on the first, static section; later sections vary per call.
      system: req.system.map((text, i) => ({
        type: "text" as const,
        text,
        ...(i === 0 && { cache_control: { type: "ephemeral" as const } }),
      })),
      messages: [{ role: "user", content: req.user }],
    },
    { signal: req.signal },
  );
  if (message.stop_reason === "refusal") throw new Error(`${model} declined the request`);
  if (message.stop_reason === "max_tokens") throw new Error(`${model} reply was cut off`);
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const cached = message.usage.cache_read_input_tokens ?? 0;
  return {
    text: extractJsonObject(text),
    model,
    usage: {
      input: message.usage.input_tokens + cached + (message.usage.cache_creation_input_tokens ?? 0),
      cached,
      output: message.usage.output_tokens,
    },
  };
}

/**
 * One call to OpenAI.
 * @param req - The request.
 * @returns The JSON text, the model and token usage.
 */
async function callOpenAi(req: JsonCompletionRequest): Promise<JsonCompletionResult> {
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: req.timeoutMs,
    maxRetries: req.maxRetries,
  });
  const completion = await client.chat.completions.create(
    {
      model: req.openAiModel,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      response_format: { type: "json_object" },
      messages: [
        ...req.system.map((content) => ({ role: "system" as const, content })),
        { role: "user" as const, content: req.user },
      ],
    },
    { signal: req.signal },
  );
  return {
    text: completion.choices[0]?.message?.content ?? "",
    model: req.openAiModel,
    usage: {
      input: completion.usage?.prompt_tokens ?? 0,
      cached: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      output: completion.usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Sends one JSON call to the feature's provider (or the other when it has no key), retrying once
 * on the other provider per {@link shouldFallBack}. The answering model is returned for logs.
 * @param req - The feature, prompt, limits and the OpenAI model.
 * @returns The JSON text, the answering model and token usage.
 */
export async function jsonCompletion(req: JsonCompletionRequest): Promise<JsonCompletionResult> {
  const primary: AiProvider = usesAnthropic(req.feature) ? "anthropic" : "openai";
  const backup: AiProvider = primary === "anthropic" ? "openai" : "anthropic";
  /**
   * Sends this request to one provider.
   * @param provider - Which provider answers.
   * @returns That provider's result.
   */
  const call = (provider: AiProvider): Promise<JsonCompletionResult> =>
    provider === "anthropic" ? callAnthropic(req) : callOpenAi(req);

  if (!hasKey(primary)) {
    if (!hasKey(backup)) throw new Error("No AI provider API key is set");
    return call(backup);
  }
  try {
    return await call(primary);
  } catch (err) {
    if (!shouldFallBack(err) || !hasKey(backup) || req.signal?.aborted) throw err;
    console.warn(
      `[ai] ${req.feature}: ${primary} failed (${err instanceof Error ? err.message : String(err)}), trying ${backup}`,
    );
    return call(backup);
  }
}
