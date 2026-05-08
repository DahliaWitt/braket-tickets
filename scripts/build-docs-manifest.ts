#!/usr/bin/env tsx
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';

const args = process.argv.slice(2);
const getArg = (name: string, fallback: string): string => {
  const idx = args.indexOf('--' + name);
  return idx !== -1 && args[idx + 1] ? (args[idx + 1] as string) : fallback;
};

const scriptDir = import.meta.dirname;
const repoRoot = path.resolve(scriptDir, '..');
const inputDir = path.resolve(
  repoRoot,
  getArg('input', 'frontend/public/docs'),
);
const outputFile = path.resolve(
  repoRoot,
  getArg('output', 'frontend/public/docs/manifest.json'),
);
const developerSourceDir = path.resolve(repoRoot, 'docs');
const developerMirrorDir = path.join(inputDir, 'developers');
const watchMode = args.includes('--watch');

const REQUIRED_FIELDS = ['title', 'category', 'order'];
const MAX_BODY_LENGTH = 2000;
const SECTIONS = ['users', 'admins', 'developers'];
const EXCLUDED_DIRS = new Set(['superpowers', 'plans', 'api', 'node_modules']);
const EXCLUDED_FILES = new Set(['README.md', 'AGENTS.md', 'CLAUDE.md']);

function isExcluded(relPath: string): boolean {
  const segments = relPath.split(path.sep);
  for (const seg of segments) {
    if (seg.startsWith('.')) return true;
    if (EXCLUDED_DIRS.has(seg)) return true;
  }
  const last = segments[segments.length - 1];
  if (EXCLUDED_FILES.has(last)) return true;
  return false;
}

function syncDeveloperDocs(): void {
  if (!fs.existsSync(developerSourceDir)) return;
  fs.rmSync(developerMirrorDir, {recursive: true, force: true});
  fs.mkdirSync(developerMirrorDir, {recursive: true});
  fs.cpSync(developerSourceDir, developerMirrorDir, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const rel = path.relative(developerSourceDir, src);
      if (rel === '') return true;
      return !isExcluded(rel);
    },
  });
  rewriteDeveloperMirrorAssetLinks();
}

function rewriteDeveloperMirrorAssetLinks(): void {
  if (!fs.existsSync(developerMirrorDir)) return;

  for (const relPath of collectMarkdownFiles(
    developerMirrorDir,
    developerMirrorDir,
  )) {
    const file = path.join(developerMirrorDir, relPath);
    const raw = fs.readFileSync(file, 'utf-8');
    const rewritten = raw.replace(
      /\]\((?:\.\/)?assets\//g,
      '](/docs/developers/assets/',
    );
    if (rewritten !== raw) {
      fs.writeFileSync(file, rewritten);
    }
  }
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function collectMarkdownFiles(dir: string, baseDir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      out.push(...collectMarkdownFiles(abs, baseDir));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      if (EXCLUDED_FILES.has(entry.name)) continue;
      out.push(path.relative(baseDir, abs));
    }
  }
  return out;
}

function slugify(relPath: string): string {
  const noExt = relPath.replace(/\.md$/, '');
  return noExt.replace(/[\\/]/g, '-').toLowerCase();
}

function titleCase(s: string): string {
  return s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildManifest(): void {
  const articles: object[] = [];
  const slugsBySection = new Map<string, Set<string>>();
  for (const section of SECTIONS) {
    const sectionDir = path.join(inputDir, section);
    if (!fs.existsSync(sectionDir)) continue;
    const relFiles = collectMarkdownFiles(sectionDir, sectionDir);
    const seen = new Set<string>();
    slugsBySection.set(section, seen);
    for (const relPath of relFiles) {
      const abs = path.join(sectionDir, relPath);
      const raw = fs.readFileSync(abs, 'utf-8');
      const {data, content} = matter(raw);
      const d = data as Record<string, unknown>;
      for (const field of REQUIRED_FIELDS) {
        if (d[field] === undefined) {
          console.warn(
            '⚠ ' +
              section +
              '/' +
              relPath +
              ': missing required field "' +
              field +
              '"',
          );
        }
      }
      const parentDir = path.dirname(relPath);
      const baseName = path.basename(relPath, '.md');
      const isCategoryIndex = baseName === 'index' && parentDir !== '.';
      const slug = isCategoryIndex
        ? parentDir.split(path.sep).join('-').toLowerCase()
        : slugify(relPath);
      if (seen.has(slug)) {
        console.warn(
          '⚠ ' +
            section +
            '/' +
            relPath +
            ': duplicate slug "' +
            slug +
            '" — skipping',
        );
        continue;
      }
      seen.add(slug);
      const inferredCategory =
        parentDir === '.'
          ? 'General'
          : titleCase(parentDir.split(path.sep).pop() ?? parentDir);
      const body = stripMarkdown(content).slice(0, MAX_BODY_LENGTH);
      articles.push({
        slug,
        path: relPath.split(path.sep).join('/'),
        title:
          d['title'] ||
          titleCase(baseName === 'index' ? inferredCategory : baseName),
        category: d['category'] || inferredCategory,
        order: d['order'] ?? 999,
        categoryOrder: d['categoryOrder'] ?? null,
        description: d['description'] || '',
        access: d['access'] || 'public',
        section,
        body,
        isCategoryIndex,
      });
    }
  }
  (articles as Array<{section: string; category: string; order: number}>).sort(
    (a, b) => {
      if (a.section !== b.section) return a.section.localeCompare(b.section);
      if (a.category !== b.category)
        return a.category.localeCompare(b.category);
      return a.order - b.order;
    },
  );
  fs.mkdirSync(path.dirname(outputFile), {recursive: true});
  fs.writeFileSync(outputFile, JSON.stringify(articles, null, 2));
  console.log(
    '✓ Generated manifest with ' +
      articles.length +
      ' articles → ' +
      outputFile,
  );
}

syncDeveloperDocs();
buildManifest();

if (watchMode) {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const {default: chokidar} = await import('chokidar');
  const watcher = chokidar.watch(
    [
      path.join(inputDir, 'users', '**/*.md'),
      path.join(inputDir, 'admins', '**/*.md'),
      path.join(developerSourceDir, '**/*.md'),
    ],
    {ignoreInitial: true},
  );
  watcher.on('all', (event: string, filePath: string) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const fromDocs = filePath.startsWith(developerSourceDir);
      const label = fromDocs
        ? 'docs/' + path.relative(developerSourceDir, filePath)
        : path.relative(inputDir, filePath);
      console.log('\n📄 ' + event + ': ' + label);
      if (fromDocs) syncDeveloperDocs();
      buildManifest();
    }, 200);
  });
  console.log('👀 Watching for changes...');
}
