import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export interface ForbiddenPattern {
  name: string;
  regex: RegExp;
  guidance: string;
}

export interface Finding {
  file: string;
  line: number;
  column: number;
  name: string;
  guidance: string;
  excerpt: string;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.html']);

const IGNORED_PATH_PREFIXES = [
  'backend/convex/_generated/',
  'frontend/src/app/generated/',
  'shared/dist/',
  'scripts/dist/',
  'node_modules/',
];

const EVENT_DATE_REFERENCE = String.raw`(?:\b(?:event|evt|nextEvt|selectedEvent|activeEvent|args\.event)\.date|\b[a-zA-Z_$][\w$]*\.event\.date)`;

// Regexes intentionally catch common event-date drift patterns at lint time.
// They are a guardrail, not a replacement for using shared event-time helpers
// in typed code paths.
export const forbiddenPatterns: ForbiddenPattern[] = [
  {
    name: 'raw-angular-date-pipe',
    regex: new RegExp(`${EVENT_DATE_REFERENCE}\\s*\\|\\s*date\\b`, 'g'),
    guidance: 'Use the eventDate pipe or a shared event-time formatter.',
  },
  {
    name: 'raw-event-date-locale-format',
    regex: new RegExp(
      String.raw`new Date\([^\n)]*${EVENT_DATE_REFERENCE}[^\n)]*\)\.toLocale(?:DateString|TimeString|String)\s*\(`,
      'g',
    ),
    guidance:
      'Use shared event-time helpers instead of browser-local locale formatting.',
  },
  {
    name: 'raw-event-date-instant-parse',
    regex: new RegExp(
      String.raw`(?:new Date\([^\n)]*${EVENT_DATE_REFERENCE}[^\n)]*\)\.getTime\s*\(|Date\.parse\([^\n)]*${EVENT_DATE_REFERENCE}[^\n)]*\))`,
      'g',
    ),
    guidance:
      'Use eventStartInstantMs instead of platform-local event date parsing.',
  },
  {
    name: 'raw-event-date-key-extraction',
    regex: new RegExp(`${EVENT_DATE_REFERENCE}\\.(?:slice|split)\\s*\\(`, 'g'),
    guidance:
      'Use formatEventDateKey/todayDateKey instead of slicing ISO strings.',
  },
  {
    name: 'raw-event-date-format-date',
    regex: new RegExp(
      String.raw`\bformatDate\([^\n,]*${EVENT_DATE_REFERENCE}`,
      'g',
    ),
    guidance: 'Use the eventDate pipe or a shared event-time formatter.',
  },
  {
    name: 'raw-event-date-date-pipe-transform',
    regex: new RegExp(
      String.raw`\b(?:this\.)?datePipe\.transform\([^\n,]*${EVENT_DATE_REFERENCE}`,
      'g',
    ),
    guidance: 'Use the eventDate pipe or a shared event-time formatter.',
  },
  {
    name: 'hardcoded-event-time-zone',
    regex: /timeZone\s*:\s*['"]America\/Los_Angeles['"]/g,
    guidance:
      'Import DEFAULT_EVENT_TIME_ZONE or EVENT_DATE_TIME_ZONE from the shared adapter.',
  },
];

export function extensionFor(file: string): string {
  const match = /\.[^.]+$/.exec(file);
  return match?.[0] ?? '';
}

export function shouldScan(file: string): boolean {
  if (!SOURCE_EXTENSIONS.has(extensionFor(file))) return false;
  if (/\.(spec|test)\.ts$/.test(file)) return false;
  return !IGNORED_PATH_PREFIXES.some((prefix) => file.startsWith(prefix));
}

export function listSourceFiles(): string[] {
  return execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .filter(shouldScan);
}

export function positionFor(
  content: string,
  index: number,
): {line: number; column: number} {
  const before = content.slice(0, index);
  const lines = before.split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1]!.length + 1,
  };
}

export function lineExcerpt(content: string, line: number): string {
  return content.split('\n')[line - 1]?.trim() ?? '';
}

export function findMatches(file: string, content: string): Finding[] {
  const findings: Finding[] = [];

  for (const pattern of forbiddenPatterns) {
    pattern.regex.lastIndex = 0;
    for (const match of content.matchAll(pattern.regex)) {
      if (match.index === undefined) continue;
      const position = positionFor(content, match.index);
      findings.push({
        file,
        ...position,
        name: pattern.name,
        guidance: pattern.guidance,
        excerpt: lineExcerpt(content, position.line),
      });
    }
  }

  return findings;
}

export function reportFindings(findings: Finding[]): void {
  console.error('Event-time drift guard found forbidden date/time patterns:\n');
  for (const finding of findings) {
    console.error(
      `${finding.file}:${finding.line}:${finding.column} ${finding.name}`,
    );
    console.error(`  ${finding.excerpt}`);
    console.error(`  ${finding.guidance}\n`);
  }
}

export function main(): void {
  const findings = listSourceFiles().flatMap((file) =>
    findMatches(file, readFileSync(file, 'utf8')),
  );

  if (findings.length === 0) return;

  reportFindings(findings);
  process.exit(1);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
