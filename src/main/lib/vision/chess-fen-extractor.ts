import { flipBoardPerspective } from '../chess/fen-utils';

export type FenCandidateSource =
  | 'explicit'
  | 'raw'
  | 'board_only'
  | 'tagged_raw_board'
  | 'board_mapping_string_rows';

export interface FenCandidate {
  fen: string;
  source: FenCandidateSource;
}

interface ExtractOptions {
  sanitizeText?: (text: string) => string;
}

function normalizeFenText(text: string, sanitizeText?: (text: string) => string): string {
  const cleaned = sanitizeText ? sanitizeText(text) : text;
  return cleaned
    .replace(/[\u2018\u2019\u201c\u201d]/g, '')
    .replace(/[.,;:]+$/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function isValidFenBoard(board: string): boolean {
  const ranks = board.split('/');
  if (ranks.length !== 8) return false;

  let whiteKings = 0;
  let blackKings = 0;

  for (const rank of ranks) {
    let squares = 0;
    for (const char of rank) {
      if (/^[1-8]$/.test(char)) {
        squares += Number(char);
        continue;
      }

      if (!/^[prnbqkPRNBQK]$/.test(char)) return false;

      squares += 1;
      if (char === 'K') whiteKings += 1;
      if (char === 'k') blackKings += 1;
    }

    if (squares !== 8) return false;
  }

  if (whiteKings > 1 || blackKings > 1) return false;
  return whiteKings + blackKings >= 1;
}

export function isSemanticFenValid(board: string): boolean {
  let whitePawns = 0;
  let blackPawns = 0;
  let whiteTotal = 0;
  let blackTotal = 0;

  const ranks = board.split('/');
  for (let rankIdx = 0; rankIdx < ranks.length; rankIdx++) {
    const rank = ranks[rankIdx]!;
    for (const char of rank) {
      if (/^[1-8]$/.test(char)) continue;

      if (char === 'P') {
        whitePawns++;
        if (rankIdx === 0 || rankIdx === 7) return false;
      } else if (char === 'p') {
        blackPawns++;
        if (rankIdx === 0 || rankIdx === 7) return false;
      }

      if (/^[PRNBQK]$/.test(char)) whiteTotal++;
      if (/^[prnbqk]$/.test(char)) blackTotal++;
    }
  }

  if (whitePawns > 8 || blackPawns > 8) return false;
  if (whiteTotal > 16 || blackTotal > 16) return false;

  return true;
}

export function parseFenCandidate(candidate: string, options: ExtractOptions = {}): string | null {
  const fen = normalizeFenText(candidate, options.sanitizeText);
  if (!fen) return null;

  const parts = fen.split(' ');
  if (parts.length !== 6) return null;

  const [board, sideToMove, castling, enPassant, halfmoveClock, fullmoveNumber] = parts;

  if (!isValidFenBoard(board)) return null;
  if (!isSemanticFenValid(board)) return null;
  if (!/^[wb]$/.test(sideToMove)) return null;
  if (!/^(?:-|[KQkq]{1,4})$/.test(castling)) return null;
  if (!/^(?:-|[a-h][36])$/.test(enPassant)) return null;
  if (!/^\d+$/.test(halfmoveClock) || !/^\d+$/.test(fullmoveNumber)) return null;
  if (Number(fullmoveNumber) < 1) return null;

  return fen;
}

export function hasNoBoardRawBoard(text: string): boolean {
  const rawBoardMatches = [...text.matchAll(/<raw_board>\s*([\s\S]*?)\s*<\/raw_board>/gi)];
  const rawBoardContent = rawBoardMatches[rawBoardMatches.length - 1]?.[1]?.trim() || '';
  return rawBoardContent.toUpperCase() === 'NO_BOARD';
}

function perspectiveFromText(text: string): 'white' | 'black' {
  const perspectiveMatch = text.match(/<perspective>\s*([\s\S]*?)\s*<\/perspective>/i);
  const perspectiveRaw = perspectiveMatch?.[1]?.toLowerCase() || '';
  return perspectiveRaw.includes('black') ? 'black' : 'white';
}

function extractFenFromTaggedChessOutput(text: string, options: ExtractOptions): string | null {
  const rawBoardMatches = [...text.matchAll(/<raw_board>\s*([\s\S]*?)\s*<\/raw_board>/gi)];
  if (!rawBoardMatches.length || hasNoBoardRawBoard(text)) return null;

  const perspective = perspectiveFromText(text);
  const rawBoard = (rawBoardMatches[rawBoardMatches.length - 1]?.[1]?.trim() || '').replace(/\s+/g, '');
  if (!rawBoard || !isValidFenBoard(rawBoard)) return null;

  const board = perspective === 'black' ? flipBoardPerspective(rawBoard) : rawBoard;
  return parseFenCandidate(`${board} w - - 0 1`, options);
}

function extractFenFromBoardMappingStrings(text: string, options: ExtractOptions): string | null {
  const perspective = perspectiveFromText(text);
  const matches = [...text.matchAll(/\(\s*String\s*:\s*([prnbqkPRNBQK1-8]+)\s*\)/gi)];
  if (matches.length < 8) return null;

  const rows = matches.slice(0, 8).map((m) => (m[1] || '').trim());
  if (rows.some((row) => !row)) return null;

  const rawBoard = rows.join('/');
  if (!isValidFenBoard(rawBoard)) return null;

  const board = perspective === 'black' ? flipBoardPerspective(rawBoard) : rawBoard;
  return parseFenCandidate(`${board} w - - 0 1`, options);
}

export function extractFenCandidates(text: string, options: ExtractOptions = {}): FenCandidate[] {
  const candidates: FenCandidate[] = [];
  const normalizedText = normalizeFenText(text, options.sanitizeText);

  const taggedFen = extractFenFromTaggedChessOutput(text, options);
  if (taggedFen) {
    candidates.push({ fen: taggedFen, source: 'tagged_raw_board' });
  }

  const mappingFen = extractFenFromBoardMappingStrings(text, options);
  if (mappingFen) {
    candidates.push({ fen: mappingFen, source: 'board_mapping_string_rows' });
  }

  const explicitFenRegex = /(?:^|[|\n\r\s])(?:fen)\s*[:=]\s*([^|\n\r]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = explicitFenRegex.exec(normalizedText)) !== null) {
    const fen = parseFenCandidate(match[1] || '', options);
    if (fen) candidates.push({ fen, source: 'explicit' });
  }

  const rawFenRegex = /([prnbqkPRNBQK1-8/]+\s+[wb]\s+(?:-|[KQkq]{1,4})\s+(?:-|[a-h][36])\s+\d+\s+\d+)/g;
  while ((match = rawFenRegex.exec(normalizedText)) !== null) {
    const fen = parseFenCandidate(match[1] || '', options);
    if (fen) candidates.push({ fen, source: 'raw' });
  }

  const boardOnlyRegex = /([prnbqkPRNBQK1-8]+(?:\/[prnbqkPRNBQK1-8]+){7})/g;
  while ((match = boardOnlyRegex.exec(normalizedText)) !== null) {
    const board = match[1] || '';
    if (!isValidFenBoard(board)) continue;
    const fen = parseFenCandidate(`${board} w - - 0 1`, options);
    if (fen) candidates.push({ fen, source: 'board_only' });
  }

  return candidates;
}

export function extractFenFromBoardMappingWindow(
  texts: readonly string[],
  options: ExtractOptions = {},
): string | null {
  if (texts.length === 0) return null;

  const rowMap = new Map<number, string>();
  let perspective: 'white' | 'black' = 'white';

  for (let i = texts.length - 1; i >= 0; i--) {
    const text = texts[i]!;
    const perspectiveMatch = text.match(/<perspective>\s*([\s\S]*?)\s*<\/perspective>/i);
    if (perspectiveMatch?.[1]) {
      perspective = perspectiveMatch[1].toLowerCase().includes('black') ? 'black' : 'white';
    }

    const matches = [...text.matchAll(/Visual Row\s+(\d+).*?\(\s*String\s*:\s*([prnbqkPRNBQK1-8]+)\s*\)/gi)];
    for (const match of matches) {
      const rowIndex = Number(match[1]);
      const rowValue = (match[2] || '').trim();
      if (!rowValue || Number.isNaN(rowIndex)) continue;
      if (!rowMap.has(rowIndex)) rowMap.set(rowIndex, rowValue);
    }
  }

  if (rowMap.size < 8) return null;

  const rows: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const row = rowMap.get(i);
    if (!row) return null;
    rows.push(row);
  }

  const rawBoard = rows.join('/');
  if (!isValidFenBoard(rawBoard)) return null;

  const board = perspective === 'black' ? flipBoardPerspective(rawBoard) : rawBoard;
  return parseFenCandidate(`${board} w - - 0 1`, options);
}
