#!/usr/bin/env node
// CLI interface for memory-sqlite-sync
import { runClaudeCodeSync, startWatching } from './sync_engine/claude_code/index.js';
function usage() {
  console.log(`
memory-sqlite-sync CLI

Commands:
  sync      Run one-time sync of all JSONL files
  start     Start real-time watcher daemon
  stop      Use "docker compose down" to stop
  status    Use "docker compose ps" to check status
  help      Show this help
`);
}

async function sync() {
  console.log('Running one-time sync...');
  await runClaudeCodeSync();
  console.log('Sync complete.');
}

async function startDaemon() {
  console.log('Starting watcher daemon...');
  
  const watcher = await startWatching();
  
  process.on('SIGINT', () => {
    console.log('\nShutting down watcher...');
    watcher.close();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    watcher.close();
    process.exit(0);
  });
  
  console.log('Watcher daemon started.');
}


function stopDaemon() {
  console.log('Use "docker compose down" to stop the watcher.');
}

function status() {
  console.log('Use "docker compose ps" to check watcher status.');
}

async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'sync':
      await sync();
      break;
    case 'start':
      await startDaemon();
      break;
    case 'stop':
      stopDaemon();
      break;
    case 'status':
      status();
      break;
    case 'help':
    case undefined:
      usage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }
}

main().catch(console.error);