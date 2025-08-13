#!/usr/bin/env tsx
// Verify database latency for Claude Code sync

import { getDatabase } from '../sync_engine/execute/schema.js';
import { getProjectsPath } from '../sync_engine/utils/paths.js';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

interface LatencyCheck {
  claudeCodeLatest: string | null;
  jsonlLatest: string | null;
  gapSeconds: number;
  status: 'healthy' | 'delayed' | 'stale';
}

function getLatestTimestamp(db: any, query: string): string | null {
  try {
    const result = db.prepare(query).get();
    return result?.timestamp || null;
  } catch (error) {
    console.error('Database query error:', error);
    return null;
  }
}

function getLatestJsonlTimestamp(): string | null {
  try {
    const projectsDir = getProjectsPath();
    
    console.log(`🔍 Scanning JSONL files in: ${projectsDir}`);
    
    // Find the most recent .jsonl file and get its last timestamp
    const projectDirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter((dirent: any) => dirent.isDirectory())
      .map((dirent: any) => dirent.name);
    
    console.log(`📁 Found ${projectDirs.length} project directories`);
    
    let latestTimestamp: string | null = null;
    let totalFiles = 0;
    let processedMessages = 0;
    
    for (const projectDir of projectDirs) {
      const projectPath = join(projectsDir, projectDir);
      try {
        const files = readdirSync(projectPath).filter((f: string) => f.endsWith('.jsonl'));
        totalFiles += files.length;
        
        for (const file of files) {
          const filePath = join(projectPath, file);
          try {
            const content = readFileSync(filePath, 'utf8');
            const lines = content.trim().split('\n').filter(line => line.trim());
            
            if (lines.length > 0) {
              const lastLine = lines[lines.length - 1];
              try {
                const lastMessage = JSON.parse(lastLine);
                const timestamp = lastMessage.timestamp;
                processedMessages++;
                
                if (timestamp && (!latestTimestamp || timestamp > latestTimestamp)) {
                  latestTimestamp = timestamp;
                }
              } catch (parseError) {
                // Skip malformed JSON
              }
            }
          } catch (fileError) {
            console.log(`⚠️  Could not read file: ${filePath}`);
          }
        }
      } catch (dirError) {
        // Skip directories we can't read
      }
    }
    
    console.log(`📊 Processed ${totalFiles} JSONL files, ${processedMessages} messages`);
    return latestTimestamp;
  } catch (error) {
    console.error('JSONL scan error:', error);
    return null;
  }
}

function calculateGap(timestamp1: string | null, timestamp2: string | null): number {
  if (!timestamp1 || !timestamp2) return -1;
  
  const date1 = new Date(timestamp1);
  const date2 = new Date(timestamp2);
  
  return Math.abs(date1.getTime() - date2.getTime()) / 1000;
}

function determineStatus(gapSeconds: number): 'healthy' | 'delayed' | 'stale' {
  if (gapSeconds < 0) return 'stale';
  if (gapSeconds < 1) return 'healthy';
  if (gapSeconds < 10) return 'delayed';
  return 'stale';
}

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return 'NULL';
  
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  let ageStr = '';
  if (hours > 0) ageStr = `${hours}h ${minutes % 60}m ago`;
  else if (minutes > 0) ageStr = `${minutes}m ${seconds % 60}s ago`;
  else ageStr = `${seconds}s ago`;
  
  return `${date.toLocaleString()} (${ageStr})`;
}

export function checkLatency(): LatencyCheck {
  console.log('🔍 Checking database latency...');
  console.log('=' * 60);
  
  // Get latest timestamps
  const jsonlLatest = getLatestJsonlTimestamp();
  console.log(`📄 Latest JSONL timestamp: ${formatTimestamp(jsonlLatest)}`);
  
  const ccDb = getDatabase();
  const claudeCodeLatest = getLatestTimestamp(ccDb, 'SELECT timestamp FROM messages ORDER BY timestamp DESC LIMIT 1');
  ccDb.close();
  console.log(`🗄️  Latest Claude Code DB timestamp: ${formatTimestamp(claudeCodeLatest)}`);
  
  
  // Calculate gap
  const overallGap = calculateGap(jsonlLatest, claudeCodeLatest);
  
  console.log(`\n ⏱️  Latency Analysis:`);
  console.log(`   JSONL → Claude Code: ${overallGap >= 0 ? overallGap.toFixed(3) + 's' : 'N/A (missing JSONL data)'}`);
  
  const status = determineStatus(overallGap);
  const statusEmoji = {
    healthy: '🟢',
    delayed: '🟡', 
    stale: '🔴'
  }[status];
  
  console.log(`\n ${statusEmoji} Status: ${status.toUpperCase()}`);
  
  if (status === 'healthy') {
    console.log('✅ Sub-second sync latency achieved!');
  } else if (status === 'delayed') {
    console.log('⚠️  Sync delay detected but within acceptable range');
  } else {
    console.log('❌ Significant sync lag or missing data');
    if (!jsonlLatest) {
      console.log('💡 Issue: Cannot find latest JSONL timestamp - check file permissions or directory structure');
    }
  }
  
  return {
    claudeCodeLatest,
    jsonlLatest,
    gapSeconds: overallGap,
    status
  };
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  checkLatency();
}
