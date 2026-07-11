import fs from 'node:fs';
import path from 'node:path';
import { isSemanticFenValid, isValidFenBoard } from '../../src/main/lib/vision/chess-fen-extractor';
import {
  getCanonicalMoveHistorySnapshot,
  type CanonicalHistoryState,
  updateCanonicalHistoryState,
} from '../../src/main/lib/chess/canonical-history';

const EXPECTED_INVALID = new Set([
  '0009_rnbqk1nr-pppp1ppp-8-3p1b2-4P3-5P2-PPPPP1PP-RNBQKBNR.png',
  '0009_rnbqk1nr-ppppbppp-4b3-4p3-4P3-5P2-PPPP2PP-RNBQKBNR.png',
  '0019_rnbqk1nr-ppp2ppp-5p2-2bpp3-4P3-3P1P2-PPP1N1PP-RNBQKB1R.png',
  '0020_rnbqk1nr-ppp2ppp-5p2-2bpp3-4P3-3P1P2-PPP1N1PP-RNBQKB1R.png',
  '0022_rnbqk1nr-ppp2ppp-5p2-2bpp3-4P3-3P1P2-PPP1N1PP-RNBQKB1R.png',
  '0023_rnbqk1nr-ppp2ppp-5p2-2bpp3-4P3-3P1P2-PPP1N1PP-RNBQKB1R.png',
]);

const EXPECTED_REPLAY_SANS = ['e4', 'd3'];
const EXPECTED_REPLAY_SNAPSHOT = [
  { no: 1, white: 'e4' },
  { no: 2, white: 'd3' },
];

function boardFromFixtureName(fileName: string): string {
  const stem = path.basename(fileName, '.png');
  return stem.replace(/^\d+_/, '').replaceAll('-', '/');
}

function frameIndexFromFixtureName(fileName: string): string {
  const match = fileName.match(/^\d+/);
  if (!match) throw new Error(`Fixture name does not start with a frame index: ${fileName}`);
  return match[0];
}

function isWhitePerspectiveBoard(board: string): boolean {
  const firstRank = board.split('/')[0] ?? '';
  return firstRank === firstRank.toLowerCase();
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function main(): void {
  const framesDir = path.join(process.cwd(), 'test-data', 'fixtures', 'project-frames');
  if (!fs.existsSync(framesDir)) {
    throw new Error(`Missing fixture directory: ${framesDir}`);
  }

  const files = fs.readdirSync(framesDir)
    .filter((file) => file.endsWith('.png'))
    .sort();

  const invalid: string[] = [];
  const validByFrame = new Map<string, Array<{ file: string; board: string }>>();
  for (const file of files) {
    const board = boardFromFixtureName(file);
    const fen = `${board} w - - 0 1`;
    if (!isValidFenBoard(board) || !isSemanticFenValid(fen)) {
      invalid.push(file);
      continue;
    }

    const frameIndex = frameIndexFromFixtureName(file);
    const frameCandidates = validByFrame.get(frameIndex) ?? [];
    frameCandidates.push({ file, board });
    validByFrame.set(frameIndex, frameCandidates);
  }

  const unexpectedInvalid = invalid.filter((file) => !EXPECTED_INVALID.has(file));
  const missingInvalid = [...EXPECTED_INVALID].filter((file) => !invalid.includes(file));

  const replayState: CanonicalHistoryState = {
    canonicalMoveHistory: [],
    pendingCanonicalEntry: null,
    prevPendingCanonicalEntry: null,
  };
  const replayedFrames: string[] = [];

  for (const [, candidates] of [...validByFrame.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [selected] = candidates.sort((a, b) => {
      const perspectiveScore = Number(isWhitePerspectiveBoard(b.board)) - Number(isWhitePerspectiveBoard(a.board));
      return perspectiveScore || a.file.localeCompare(b.file);
    });
    if (!selected) continue;
    replayedFrames.push(selected.file);
    updateCanonicalHistoryState(replayState, selected.board, `${selected.board} w - - 0 1`);
  }

  const replaySnapshot = getCanonicalMoveHistorySnapshot(replayState.canonicalMoveHistory);
  const replaySans = replayState.canonicalMoveHistory
    .map((entry) => entry.san)
    .filter((san): san is string => !!san);
  const replayLooksHealthy =
    sameJsonValue(replaySans, EXPECTED_REPLAY_SANS)
    && sameJsonValue(replaySnapshot, EXPECTED_REPLAY_SNAPSHOT);

  if (
    files.length !== 43
    || invalid.length !== EXPECTED_INVALID.size
    || unexpectedInvalid.length > 0
    || missingInvalid.length > 0
    || !replayLooksHealthy
  ) {
    console.error(JSON.stringify({
      totalFrames: files.length,
      validFrames: files.length - invalid.length,
      invalidFrames: invalid.length,
      unexpectedInvalid,
      missingInvalid,
      replayedFrames: replayedFrames.length,
      expectedReplaySans: EXPECTED_REPLAY_SANS,
      replaySans,
      expectedReplaySnapshot: EXPECTED_REPLAY_SNAPSHOT,
      replaySnapshot,
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    totalFrames: files.length,
    validFrames: files.length - invalid.length,
    knownInvalidFrames: invalid.length,
    replayedFrames: replayedFrames.length,
    expectedReplaySans: EXPECTED_REPLAY_SANS,
    replaySans,
    expectedReplaySnapshot: EXPECTED_REPLAY_SNAPSHOT,
    replaySnapshot,
  }, null, 2));
}

main();
