import type { ModelId, Usage } from "./models.ts";

// OpenAI-compatible Chat Completions client for the Meta Model API.

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };
export type Message = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };

export type ChatRequest = {
  model: ModelId;
  messages: Message[];
  response_format?: unknown;
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
  max_tokens?: number;
  temperature?: number;
};

export type ChatResult = { content: string; finish_reason: string; usage: Usage; request_id: string | null; ms: number };

export class MetaError extends Error {
  constructor(readonly status: number, readonly retryable: boolean, message: string) {
    super(message);
  }
}

export type MetaClient = (req: ChatRequest, signal?: AbortSignal) => Promise<ChatResult>;

export function metaClient(apiKey: string, baseUrl = "https://api.meta.ai/v1"): MetaClient {
  return async (req, signal) => {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(req),
        signal,
      });
    } catch (e) {
      throw new MetaError(0, true, `network: ${(e as Error).message}`);
    }
    const body = (await res.json().catch(() => null)) as any;
    if (!res.ok) {
      // 400/401/403/413 are the caller's fault and never retried; 429 and 5xx are.
      throw new MetaError(res.status, res.status === 429 || res.status >= 500, body?.error?.message ?? `HTTP ${res.status}`);
    }
    const choice = body.choices?.[0];
    return {
      content: choice?.message?.content ?? "",
      finish_reason: choice?.finish_reason ?? "unknown",
      usage: {
        prompt_tokens: body.usage?.prompt_tokens ?? 0,
        cached_tokens: body.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        completion_tokens: body.usage?.completion_tokens ?? 0,
        reasoning_tokens: body.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      },
      request_id: res.headers.get("x-request-id"),
      ms: Date.now() - t0,
    };
  };
}
