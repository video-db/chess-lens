import fs from 'node:fs';
import path from 'node:path';
import { isSemanticFenValid, isValidFenBoard } from '../../src/main/lib/vision/chess-fen-extractor';
import {
  getCanonicalMoveHistorySnapshot,
  type CanonicalHistoryState,
  updateCanonicalHistoryState,
} from '../../src/main/lib/chess/canonical-history';
import {
  computeKeyMomentIndices,
  formatTipTimestamp,
  getDisplayKeyMomentTips,
  getMoveLabel,
  type KeyMomentTip,
} from '../../src/renderer/components/history/recording-analysis-utils';

const EXPECTED_REPLAY_SANS = ['e4', 'd3'];

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

function replayFixtureFrames(): {
  replaySans: string[];
  replaySnapshot: ReturnType<typeof getCanonicalMoveHistorySnapshot>;
} {
  const framesDir = path.join(process.cwd(), 'test-data', 'fixtures', 'project-frames');
  if (!fs.existsSync(framesDir)) {
    throw new Error(`Missing fixture directory: ${framesDir}`);
  }

  const files = fs.readdirSync(framesDir)
    .filter((file) => file.endsWith('.png'))
    .sort();
  const validByFrame = new Map<string, Array<{ file: string; board: string }>>();

  for (const file of files) {
    const board = boardFromFixtureName(file);
    const fen = `${board} w - - 0 1`;
    if (!isValidFenBoard(board) || !isSemanticFenValid(fen)) continue;

    const frameIndex = frameIndexFromFixtureName(file);
    const frameCandidates = validByFrame.get(frameIndex) ?? [];
    frameCandidates.push({ file, board });
    validByFrame.set(frameIndex, frameCandidates);
  }

  const replayState: CanonicalHistoryState = {
    canonicalMoveHistory: [],
    pendingCanonicalEntry: null,
    prevPendingCanonicalEntry: null,
  };

  for (const [, candidates] of [...validByFrame.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [selected] = candidates.sort((a, b) => {
      const perspectiveScore = Number(isWhitePerspectiveBoard(b.board)) - Number(isWhitePerspectiveBoard(a.board));
      return perspectiveScore || a.file.localeCompare(b.file);
    });
    if (!selected) continue;
    updateCanonicalHistoryState(replayState, selected.board, `${selected.board} w - - 0 1`);
  }

  return {
    replaySans: replayState.canonicalMoveHistory
      .map((entry) => entry.san)
      .filter((san): san is string => !!san),
    replaySnapshot: getCanonicalMoveHistorySnapshot(replayState.canonicalMoveHistory),
  };
}

function buildFixtureTips(replaySans: string[]): KeyMomentTip[] {
  return replaySans.map((san, index) => {
    const isSecondMove = index === 1;
    return {
      id: `fixture-${index + 1}`,
      startTime: (index + 1) * 12,
      tip: isSecondMove
        ? `White's ${san} loses momentum; review the pawn structure and development plan before committing.`
        : `White's ${san} claims central space and gives the post-game analysis a concrete move to discuss.`,
      winChanceBefore: isSecondMove ? 70 : 50,
      winChance: isSecondMove ? 25 : 55,
      centipawnLoss: isSecondMove ? 450 : 10,
      turn: 'w',
    };
  });
}

function main(): void {
  const { replaySans, replaySnapshot } = replayFixtureFrames();
  const tips = buildFixtureTips(replaySans);
  const keyMomentIndices = computeKeyMomentIndices(tips);
  const displayTips = getDisplayKeyMomentTips(tips);
  const moveLabels = displayTips.map((tip) => getMoveLabel(tip.tip));
  const jumpLabels = displayTips.map((tip) => formatTipTimestamp(tip.startTime));
  const insights = [
    {
      topic: 'Replay Coverage',
      points: [`Fixture produced ${replaySans.length} concrete SAN move(s): ${replaySans.join(', ')}.`],
    },
    {
      topic: 'Key Moment Coverage',
      points: [`Post-game cards selected ${displayTips.length} display moment(s).`],
    },
  ];

  const failures: string[] = [];
  if (JSON.stringify(replaySans) !== JSON.stringify(EXPECTED_REPLAY_SANS)) {
    failures.push(`Expected replay SANs ${JSON.stringify(EXPECTED_REPLAY_SANS)}, got ${JSON.stringify(replaySans)}`);
  }
  if (replaySnapshot.length === 0) {
    failures.push('Replay snapshot is empty; post-game analysis would have no move list.');
  }
  if (tips.length === 0) {
    failures.push('No gameplay tips were derived from fixture replay.');
  }
  if (keyMomentIndices.size === 0) {
    failures.push('No key moments were selected from fixture replay tips.');
  }
  if (displayTips.length === 0) {
    failures.push('Key Moments card would render empty.');
  }
  if (moveLabels.some((label) => label === '-')) {
    failures.push(`One or more display tips failed move-label extraction: ${JSON.stringify(moveLabels)}`);
  }
  if (jumpLabels.some((label) => !/^\d{2}:\d{2}$/.test(label))) {
    failures.push(`One or more timestamp labels are invalid: ${JSON.stringify(jumpLabels)}`);
  }
  if (insights.length < 2 || insights.some((item) => item.points.length === 0)) {
    failures.push('Insights fixture is empty or incomplete.');
  }

  const report = {
    replaySans,
    replaySnapshot,
    gameplayTips: tips.length,
    keyMomentIndices: [...keyMomentIndices],
    displayTipIds: displayTips.map((tip) => tip.id),
    moveLabels,
    jumpLabels,
    insightTopics: insights.map((item) => item.topic),
  };

  if (failures.length > 0) {
    console.error(JSON.stringify({ ...report, failures }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
