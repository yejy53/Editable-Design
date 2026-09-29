import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const destination = path.join(repo, 'site-dist');
const git = (args, options = {}) => execFileSync('git', args, {
  cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], ...options,
}).trim();

// Publish only the assembled artifact. Keep the source checkout and index intact.
for (const file of ['.nojekyll', 'index.html', 'player.html',
  'zh/blog/genclaw-next/index.html', 'en/blog/genclaw-next/index.html']) {
  if (!existsSync(path.join(destination, file))) throw new Error(`Missing ${file}; build and assemble first.`);
}
if (git(['remote', 'get-url', '--push', 'origin']) !== 'git@github.com:yejy53/Editable-Design.git') {
  throw new Error('Expected the Editable-Design SSH remote.');
}
git(['fetch', 'origin', 'main', 'gh-pages']);
const source = git(['rev-parse', 'HEAD']);
if (source !== git(['rev-parse', 'origin/main'])) throw new Error('Push the reviewed source to main first.');
const parent = git(['rev-parse', 'origin/gh-pages']);
const scratch = mkdtempSync(path.join(tmpdir(), 'editable-design-pages-'));
const env = {
  ...process.env,
  GIT_DIR: git(['rev-parse', '--absolute-git-dir']),
  GIT_WORK_TREE: destination,
  GIT_INDEX_FILE: path.join(scratch, 'index'),
};
try {
  git(['read-tree', '--empty'], { env });
  git(['add', '--all', '--force', '--', '.'], { env, cwd: destination });
  const tree = git(['write-tree'], { env });
  if (tree === git(['rev-parse', `${parent}^{tree}`])) {
    console.log('The assembled site is already published.');
  } else {
    const commit = git(['commit-tree', tree, '-p', parent, '-m', `Publish gallery and bilingual blog from ${source}`]);
    // A regular fast-forward push rejects concurrent deployment changes.
    git(['push', 'origin', `${commit}:refs/heads/gh-pages`]);
    console.log(`Published ${commit} to gh-pages (source ${source}).`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
