// Watch Claude Code JSONL logs
import chokidar from 'chokidar';
import { readdirSync } from 'fs';
import { join } from 'path';
import { getProjectsPath } from '../../utils/paths.js';

export function watchJsonl(callback: (filePath: string) => void) {
  const projectsDir = getProjectsPath();
  
  const watchPattern = `${projectsDir}/**/*.jsonl`;
  console.log(`DEBUG: Setting up chokidar with pattern: ${watchPattern}`);
  console.log(`DEBUG: NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`DEBUG: Projects directory: ${projectsDir}`);
  
  // FIXED: Watch the directory instead of glob pattern which doesn't work in Docker
  const watcher = chokidar.watch(projectsDir, {
    ignored: /^\./, 
    persistent: true,
    ignoreInitial: true,
    usePolling: false,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50
    }
  });
  
  watcher
    .on('ready', () => {
      console.log(`DEBUG: Chokidar watcher is ready and watching`);
      const watched = watcher.getWatched();
      console.log(`DEBUG: Currently watching ${Object.keys(watched).length} directories`);
      console.log(`DEBUG: Watched object keys:`, Object.keys(watched));
      
      Object.keys(watched).forEach(dir => {
        console.log(`DEBUG: Directory "${dir}" -> files: [${watched[dir].join(', ')}]`);
      });
      
      // Try alternative glob patterns to see what works
      console.log(`DEBUG: Testing alternative patterns...`);
      const testPatterns = [
        `${projectsDir}/*.jsonl`,           // Direct children only
        `${projectsDir}/*/*.jsonl`,         // One level deep
        `${projectsDir}/**`,                // All files
        `${projectsDir}`,                   // Just the directory
      ];
      
      testPatterns.forEach(pattern => {
        const testWatcher = chokidar.watch(pattern, { ignoreInitial: false });
        testWatcher.on('ready', () => {
          const testWatched = testWatcher.getWatched();
          console.log(`DEBUG: Pattern "${pattern}" watches ${Object.keys(testWatched).length} dirs, ${Object.values(testWatched).flat().length} files`);
          testWatcher.close();
        });
      });
    })
    .on('add', (path) => {
      if (path.endsWith('.jsonl')) {
        console.log(`DEBUG: New JSONL file detected: ${path}`);
        callback(path);
      }
    })
    .on('change', (path) => {
      if (path.endsWith('.jsonl')) {
        console.log(`DEBUG: JSONL file changed: ${path}`);
        callback(path);
      }
    })
    .on('unlink', (path) => {
      console.log(`DEBUG: JSONL file removed: ${path}`);
    })
    .on('error', (error) => {
      console.error(`ERROR: Watcher error: ${error}`);
      console.error(`ERROR: Error stack: ${error.stack}`);
    })
    .on('raw', (event, path, details) => {
      console.log(`DEBUG: Raw event: ${event} on ${path}`, details);
    });
  
  console.log(`Watching for JSONL changes in ${projectsDir}`);
  console.log(`DEBUG: Chokidar watcher created successfully`);
  
  // Test if we can read the directory - SAME METHOD AS STARTUP SYNC
  try {
    const files = readdirSync(projectsDir);
    console.log(`DEBUG: Directory listing shows ${files.length} entries`);
    console.log(`DEBUG: First few entries:`, files.slice(0, 3));
    
    // Let's manually check what startup sync finds vs what chokidar should find
    console.log(`DEBUG: Manually scanning for JSONL files (same as startup sync):`);
    let totalJsonlFiles = 0;
    files.forEach(dir => {
      try {
        const dirPath = join(projectsDir, dir);
        const dirFiles = readdirSync(dirPath);
        const jsonlFiles = dirFiles.filter(f => f.endsWith('.jsonl'));
        if (jsonlFiles.length > 0) {
          console.log(`DEBUG: Found ${jsonlFiles.length} JSONL files in ${dir}`);
          jsonlFiles.slice(0, 2).forEach(file => {
            const fullPath = join(dirPath, file);
            console.log(`DEBUG: JSONL file path: ${fullPath}`);
          });
          totalJsonlFiles += jsonlFiles.length;
        }
      } catch (err) {
        console.log(`DEBUG: Cannot read subdirectory ${dir}: ${err}`);
      }
    });
    console.log(`DEBUG: Total JSONL files found manually: ${totalJsonlFiles}`);
    
  } catch (error) {
    console.error(`ERROR: Cannot read projects directory: ${error}`);
  }
  
  return watcher;
}