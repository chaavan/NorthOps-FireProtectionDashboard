/**
 * OpenAI sometimes returns JSON with literal control characters inside string
 * values (e.g. newlines in job names). JSON.parse rejects those unless escaped.
 */

function extractJsonPayload(content: string): string {
  let text = content.trim().replace(/^\uFEFF/, "");
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fenced) {
    text = fenced[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }

  return text;
}

function escapeControlCharactersInJsonStrings(input: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const code = char.charCodeAt(0);

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && inString) {
      result += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString && code >= 0 && code < 0x20) {
      if (char === "\n") result += "\\n";
      else if (char === "\r") result += "\\r";
      else if (char === "\t") result += "\\t";
      else result += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }

    result += char;
  }

  return result;
}

export function parseLenientJsonString<T = unknown>(content: string): T {
  const payload = extractJsonPayload(content);
  const candidates = [payload, escapeControlCharactersInJsonStrings(payload)];

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(message);
}

/** @deprecated Use parseLenientJsonString */
export function parseJsonObjectFromLlm<T = unknown>(content: string): T {
  return parseLenientJsonString<T>(content);
}
