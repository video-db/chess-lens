#!/usr/bin/env ts-node
// Usage: ts-node tools/recoverSession.ts <sessionId> <apiKey> [apiUrl] [collectionId]
import { checkAndRecoverSession } from '../src/main/services/recording-export.service';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: ts-node tools/recoverSession.ts <sessionId> <apiKey> [apiUrl] [collectionId]');
    process.exit(2);
  }
  const [sessionId, apiKey, apiUrl, collectionId] = args;
  try {
    const res = await checkAndRecoverSession(sessionId, apiKey, apiUrl, true, collectionId);
    console.log('checkAndRecoverSession result:', JSON.stringify(res, null, 2));
  } catch (err) {
    console.error('Error calling checkAndRecoverSession:', err);
    process.exit(1);
  }
}

main();
