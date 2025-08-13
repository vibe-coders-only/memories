#!/usr/bin/env node
// Simple chokidar test to debug file watching issues

import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';

const projectsDir = '/claude-projects';

console.log('=== CHOKIDAR DEBUG TEST ===');
console.log(`Testing directory: ${projectsDir}`);

// Test 1: Can we read the directory?
try {
  const dirs = fs.readdirSync(projectsDir);
  console.log(`✅ Directory readable. Found ${dirs.length} subdirectories:`, dirs.slice(0, 3));
  
  // Test 2: Can we find JSONL files manually?
  let totalFiles = 0;
  dirs.forEach(dir => {
    try {
      const dirPath = path.join(projectsDir, dir);
      const files = fs.readdirSync(dirPath);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
      if (jsonlFiles.length > 0) {
        console.log(`✅ Found ${jsonlFiles.length} JSONL files in ${dir}`);
        totalFiles += jsonlFiles.length;
      }
    } catch (err) {
      console.log(`❌ Cannot read ${dir}: ${err.message}`);
    }
  });
  console.log(`✅ Total JSONL files: ${totalFiles}`);
  
} catch (err) {
  console.error(`❌ Cannot read projects directory: ${err}`);
  process.exit(1);
}

// Test 3: Test different chokidar patterns
const patterns = [
  `${projectsDir}/**/*.jsonl`,
  `${projectsDir}/*/*.jsonl`, 
  `${projectsDir}/*.jsonl`,
  `${projectsDir}/**`,
  projectsDir
];

console.log('\n=== TESTING CHOKIDAR PATTERNS ===');

patterns.forEach((pattern, i) => {
  console.log(`\nPattern ${i+1}: ${pattern}`);
  
  const watcher = chokidar.watch(pattern, {
    ignoreInitial: false,
    persistent: false
  });
  
  watcher.on('ready', () => {
    const watched = watcher.getWatched();
    const dirs = Object.keys(watched).length;
    const files = Object.values(watched).flat().length;
    console.log(`  ✅ Ready: ${dirs} directories, ${files} files`);
    
    if (dirs > 0) {
      Object.keys(watched).slice(0, 2).forEach(dir => {
        console.log(`    ${dir}: [${watched[dir].slice(0, 3).join(', ')}]`);
      });
    }
    
    watcher.close();
  });
  
  watcher.on('add', (path) => {
    console.log(`  📁 Found file: ${path}`);
  });
  
  watcher.on('error', (err) => {
    console.log(`  ❌ Error: ${err}`);
  });
});

console.log('\nTest complete - check output above');