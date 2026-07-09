import {escapeCsvValue} from '../utils/export-formatting';
import {canonicalHeaderFor} from './import-header-synonyms';
import type {ImportTargetConfig} from './import-config';

/**
 * Generate the client-side CSV template for a target. Headers are the canonical
 * labels pulled from the SAME synonym constant the parser matches against, so a
 * downloaded template always round-trips: parsing it maps every column and every
 * example row validates. Example rows are deliberately fake ("example",
 * "EXAMPLE-0001") so an admin does not confirm them as real entries.
 */
export function generateTemplateCsv(config: ImportTargetConfig): string {
  const headers = config.templateFields.map((field) =>
    canonicalHeaderFor(field),
  );

  const rows = config.templateExampleRows.map((example) =>
    config.templateFields.map((field) =>
      escapeCsvValue((example[field] ?? '').trim()),
    ),
  );

  return [
    headers.map((h) => escapeCsvValue(h)).join(','),
    ...rows.map((cells) => cells.join(',')),
  ].join('\n');
}

/** Suggested download filename for a target's template. */
export function templateFilename(config: ImportTargetConfig): string {
  return config.target === 'guest'
    ? 'braket-guest-import-template.csv'
    : 'braket-external-tickets-template.csv';
}
