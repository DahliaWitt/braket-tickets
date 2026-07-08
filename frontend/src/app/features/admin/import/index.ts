// Public surface of the shared import feature. Consumers load the component
// deferred (`@defer`) so the management page bundle stays unaffected — import
// the config/types eagerly and the component lazily.

export {ImportSurfaceComponent} from './import-surface.component';
export {ImportSurfaceComponentHarness} from './import-surface.component.harness';

export {
  GUEST_IMPORT_CONFIG,
  BUYER_IMPORT_CONFIG,
  DEFAULT_SOURCE_LABEL,
  IMPORT_FIELD_LIMITS,
  type ImportTargetConfig,
  type ImportRowValues,
  type ValidatedRow,
  type RowPartition,
} from './import-config';

export {parseImportText, type ParseOptions} from './import-parser';
export {
  buildPreview,
  extractValidValues,
  type PreviewResult,
  type PreviewCounts,
} from './import-preview';
export {generateTemplateCsv, templateFilename} from './import-template';
export {
  IMPORT_HEADER_SYNONYMS,
  resolveHeaderField,
  canonicalHeaderFor,
} from './import-header-synonyms';

export type {
  ImportFieldKey,
  ParsedRow,
  ParseResult,
  HeaderColumn,
  GuestType,
} from './import.types';

export type {
  DedupMode,
  ImportConfirmPayload,
  ImportReport,
  ImportReportOutcome,
  ImportStep,
  ManualColumnMapping,
} from './import-surface.types';
