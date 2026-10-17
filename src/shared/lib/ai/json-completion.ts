// src/shared/lib/ai/json-completion.ts
// One JSON-reply model call for the AI routes, sent to OpenAI or Claude. AI_PROVIDER picks
// the provider ("openai" unless set to "anthropic"), and AI_PROVIDER_<FEATURE> overrides it
// for one feature (AI_PROVIDER_PARSE_JOB="openai" keeps the job parser on gpt-4.1 while the
// rest run on Claude). ANTHROPIC_MODEL picks the Claude model and ANTHROPIC_EFFORT whether
// Claude thinks first, so the eval harness can run the same routes against any of them
// without code changes.

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

/** Claude model used when ANTHROPIC_MODEL isn't set. */
const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-5-5";

/**
 * Output room for Claude. The OpenAI budgets are sized to gpt-4.1's terse replies; Claude
 * writes a little more around the same JSON, and a cut-off reply is a failed parse.
 */
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
export type AiFeature = "parse-job" | "estimate" | "mailing-draft" | "post-draft";

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
 * Whether a feature sends its calls to Claude instead of OpenAI. The feature's own
 * AI_PROVIDER_<FEATURE> setting wins when set; otherwise AI_PROVIDER decides.
 * @param feature - The calling feature.
 * @returns True when the provider for that feature is "anthropic".
 */
export function usesAnthropic(feature: AiFeature): boolean {
  const own = process.env[`AI_PROVIDER_${feature.toUpperCase().replace(/-/g, "_")}`];
  return (own || process.env.AI_PROVIDER) === "anthropic";
}

/**
 * Names a feature's provider, Claude model and effort, for cache keys that must not hand
 * one setup's stored answer back when another is active.
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
 * Whether any AI provider has its API key set. One is enough for every feature: a call whose
 * provider has no key, or fails on the provider's side, goes to the other one.
 * @returns True when at least one key is present.
 */
export function aiConfigured(): boolean {
  return hasKey("anthropic") || hasKey("openai");
}

/**
 * Whether an error is an upstream 429 rate limit from either provider. Both SDK errors carry
 * the response headers the rate-limit response reads its retry hint from. OpenAI also sends
 * a 429 for a used-up quota, which waiting never clears, so that one doesn't count.
 * @param err - The caught error.
 * @returns True for a rate-limit error from either SDK.
 */
export function isAiRateLimitError(err: unknown): err is { headers?: unknown } {
  if (err instanceof OpenAI.RateLimitError) return err.code !== "insufficient_quota";
  return err instanceof Anthropic.RateLimitError;
}

/**
 * Whether a failed call should go once to the other provider: the trouble is on the
 * provider's side, so the other one can still answer. That covers used-up credit (Claude's
 * billing_error or its older "credit balance is too low" 400, OpenAI's insufficient_quota
 * 429), a rejected key, a rate limit, an unreachable host and a server fault (5xx, including
 * Claude's 529 overloaded). Timeouts and aborts don't qualify - the time budget is already
 * spent - and nor do bad requests or unusable replies.
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
 * Pulls the JSON object out of a reply. Claude has no JSON mode and can wrap the object in a
 * markdown code fence or a sentence, so this keeps the outermost braces; OpenAI's
 * json_object replies pass through unchanged.
 * @param text - Raw reply text.
 * @returns The JSON object text, or the input when no braces are found.
 */
export function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start !== -1 && end > start ? text.slice(start, end + 1) : text;
}

/**
 * Thinking setting per Claude model. With an effort set, the model thinks adaptively at
 * that effort before answering. Without one, these routes get gpt-4.1's answer-straight-away
 * behaviour where the model allows it: Haiku 5.5 takes "disabled", Sonnet 5.5 rejects that
 * and takes "between_tools", which skips thinking when no tools are in play. Other models
 * keep their default.
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
 * Sends one call that should come back as a JSON object. It goes to the calling feature's
 * provider, or straight to the other one when that provider has no key. When the provider
 * fails on its own side (see {@link shouldFallBack}) the call is sent once more to the
 * other provider, so running out of credit with one doesn't take the AI features down.
 * The answering model comes back in the result, so logs show when the other one answered.
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
