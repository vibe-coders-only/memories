// Main orchestrator entry point
import { runClaudeCodeSync, startWatching } from './sync_engine/claude_code/index.js';

async function main() {
  console.log('Starting memory-sqlite-sync...');
  
  // Initial sync
  await runClaudeCodeSync();
  
  // Start real-time watching
  const watcher = startWatching();
  
  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    watcher.close();
    process.exit(0);
  });
  
  console.log('Real-time sync active. Press Ctrl+C to stop.');
}

main().catch(console.error);