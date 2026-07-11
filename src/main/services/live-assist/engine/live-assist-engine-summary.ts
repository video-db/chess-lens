export interface ParsedEngineSummaryMove {
  san: string | null;
  lan: string | null;
}

export function parseEngineSummaryMove(engineSummary?: string | null): ParsedEngineSummaryMove {
  const summary = engineSummary ?? '';

  return {
    san: summary.match(/Best move SAN:\s*(\S+)/i)?.[1] ?? null,
    lan: summary.match(/Best move LAN:\s*(\S+)/i)?.[1] ?? null,
  };
}

export function formatEngineSummaryTip(engineSummary: string): string {
  const rawSummary = engineSummary
    .split('\n')
    .filter(Boolean)
    .join(' | ');

  return `engine: ${rawSummary}`;
}
