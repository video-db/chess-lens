export function parseAlgebraicTag(text: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>\\s*([a-h][1-8])\\s*</${tag}>`, 'i');
  const match = text.match(re);
  return match ? match[1]!.toLowerCase() : null;
}

export function parsePerspectiveTag(text: string): 'white' | 'black' | null {
  const match = text.match(/<perspective>\s*(.*?)\s*<\/perspective>/is);
  if (!match?.[1]) return null;
  return match[1].toLowerCase().includes('black') ? 'black' : 'white';
}

export function parseTurnTag(text: string): 'w' | 'b' | null {
  const match = text.match(/<turn>\s*(.*?)\s*<\/turn>/is);
  if (!match?.[1]) return null;
  return match[1].toLowerCase().includes('black') ? 'b' : 'w';
}

export function extractLastRawBoard(text: string): string | null {
  const matches = [...text.matchAll(/<raw_board>\s*(.*?)\s*<\/raw_board>/gis)];
  const rawBoard = matches[matches.length - 1]?.[1];
  return rawBoard ? rawBoard.replace(/\s+/g, '').replace(/\n/g, '') : null;
}

function tryRepairRank(rank: string, actual: number): string | null {
  const excess = actual - 8;
  if (excess <= 0) return null;

  for (let i = 0; i < rank.length; i++) {
    const ch = rank[i];
    if (!ch || !/\d/.test(ch)) continue;

    const val = parseInt(ch, 10);
    const newVal = val - excess;
    if (newVal >= 1) {
      return rank.slice(0, i) + String(newVal) + rank.slice(i + 1);
    }
    if (newVal === 0) {
      return rank.slice(0, i) + rank.slice(i + 1);
    }
  }

  return null;
}

export function validateAndRepairBoard(rawBoard: string): { board: string; autoFixed: boolean } | null {
  const ranks = rawBoard.split('/');
  if (ranks.length !== 8) return null;

  const repairedRanks: string[] = [];
  let anyFixed = false;

  for (const rank of ranks) {
    let sq = 0;
    let invalid = false;

    for (const ch of rank) {
      if (/\d/.test(ch)) sq += parseInt(ch, 10);
      else if (/[pnbrqkPNBRQK]/.test(ch)) sq += 1;
      else {
        invalid = true;
        break;
      }
    }

    if (invalid) return null;
    if (sq === 8) {
      repairedRanks.push(rank);
      continue;
    }

    const fixed = tryRepairRank(rank, sq);
    if (!fixed) return null;

    let fixedSq = 0;
    for (const ch of fixed) {
      if (/\d/.test(ch)) fixedSq += parseInt(ch, 10);
      else if (/[pnbrqkPNBRQK]/.test(ch)) fixedSq += 1;
    }
    if (fixedSq !== 8) return null;

    repairedRanks.push(fixed);
    anyFixed = true;
  }

  return { board: repairedRanks.join('/'), autoFixed: anyFixed };
}
