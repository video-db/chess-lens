export function extractJsonPayload(content: string): string {
  let jsonString = content.trim();

  const completeFenceMatch = jsonString.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (completeFenceMatch) {
    jsonString = completeFenceMatch[1]!.trim();
  } else {
    jsonString = jsonString.replace(/^```(?:json)?\s*/i, '').trim();
  }

  const jsonStart = jsonString.indexOf('{');
  const jsonEnd = jsonString.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    jsonString = jsonString.slice(jsonStart, jsonEnd + 1);
  }

  return jsonString;
}

export function parseJsonPayload<T = unknown>(
  content: string,
  parseResponse?: (content: string) => T,
): T {
  const jsonString = extractJsonPayload(content);
  return parseResponse ? parseResponse(jsonString) : JSON.parse(jsonString) as T;
}
