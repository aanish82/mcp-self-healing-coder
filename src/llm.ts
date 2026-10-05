import { LLMConfig } from "./types.js";

export interface CodeFixResponse {
  files: { path: string; content: string }[];
  explanation: string;
}

export async function requestFixFromLLM(
  prompt: string,
  config: LLMConfig = {}
): Promise<CodeFixResponse> {
  const provider =
    config.provider ||
    (process.env.ANTHROPIC_API_KEY
      ? "anthropic"
      : process.env.OPENAI_API_KEY
      ? "openai"
      : "ollama");

  if (provider === "anthropic") {
    const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
    const model = config.model || process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";

    const baseURL = config.baseURL || process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
    const res = await fetch(`${baseURL}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        temperature: 0.1,
        system: "You are an expert autonomous software engineer. Your task is to inspect compiler/test diagnostics, identify root causes, and return the fixed file contents. Return ONLY a valid JSON object matching this schema: {\"files\": [{\"path\": \"relative/path/to/file\", \"content\": \"complete updated content\"}], \"explanation\": \"brief description of fix\"}. Do NOT wrap JSON in markdown ticks.",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { content?: { text?: string }[] };
    const text = data.content?.[0]?.text || "{}";
    return parseCodeFixResponse(text);
  }

  if (provider === "openai") {
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
    const baseURL = config.baseURL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    const model = config.model || process.env.OPENAI_MODEL || "gpt-4o";

    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an expert autonomous software engineer. Return a valid JSON object matching: {\"files\": [{\"path\": \"relative/path/to/file\", \"content\": \"complete updated content\"}], \"explanation\": \"brief description of fix\"}.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content || "{}";
    return parseCodeFixResponse(text);
  }

  // Fallback: Local Ollama (e.g. llama3, qwen2.5-coder)
  const ollamaURL = config.baseURL || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = config.model || process.env.OLLAMA_MODEL || "qwen2.5-coder";

  const res = await fetch(`${ollamaURL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: `You are an expert software engineer. Return ONLY a valid JSON object matching: {"files": [{"path": "relative/path/to/file", "content": "complete updated content"}], "explanation": "brief description of fix"}.\n\nTask:\n${prompt}`,
      stream: false,
      format: "json",
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama API error (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { response?: string };
  return parseCodeFixResponse(data.response || "{}");
}

function parseCodeFixResponse(raw: string): CodeFixResponse {
  let cleaned = raw.trim();
  // Strip any markdown code fences if present
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/, "").replace(/```$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/```$/, "");
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed.files)) {
      return {
        files: parsed.files.map((f: { path: string; content: string }) => ({
          path: String(f.path),
          content: String(f.content),
        })),
        explanation: parsed.explanation || "Applied fix based on diagnostics",
      };
    }
    return { files: [], explanation: "No files returned by LLM" };
  } catch (err) {
    throw new Error(`Failed to parse LLM JSON response: ${(err as Error).message}\nRaw output: ${raw.slice(0, 300)}`);
  }
}
