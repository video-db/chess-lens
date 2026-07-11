import { describe, expect, it } from 'vitest';
import { extractJsonPayload, parseJsonPayload } from '../../../../src/main/lib/llm/llm-json';

describe('llm-json helpers', () => {
  it('extracts JSON from a fenced response', () => {
    expect(extractJsonPayload('```json\n{"ok":true}\n```')).toBe('{"ok":true}');
  });

  it('extracts the outer JSON object from explanatory text', () => {
    expect(extractJsonPayload('Here is the answer: {"move":"e4"} thanks')).toBe('{"move":"e4"}');
  });

  it('handles partial opening fences from truncated model responses', () => {
    expect(extractJsonPayload('```json\n{"partial":true}')).toBe('{"partial":true}');
  });

  it('supports custom parsers', () => {
    expect(parseJsonPayload('{"value":3}', (text) => JSON.parse(text).value as number)).toBe(3);
  });
});
