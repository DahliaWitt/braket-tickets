import type { CommunityPublicationStatus } from '@shared/domain/community-publication-status';

export interface CommunityProfileFormValue {
  name: string;
  email: string;
  contactInfo: string;
  description: string;
  website: string;
  slug: string;
  status: CommunityPublicationStatus;
  isPublicDirectory: boolean;
  codeOfConduct: string;
}

export interface VettingQuestionFormValue {
  id: string;
  question: string;
  type: string;
  required: boolean;
  options: string[];
  optionsString: string;
}

function createEmptyVettingQuestion(): VettingQuestionFormValue {
  return {
    id: crypto.randomUUID(),
    question: '',
    type: 'text',
    required: true,
    options: [],
    optionsString: '',
  };
}

export function isProfileDirty(
  current: CommunityProfileFormValue,
  pristine: CommunityProfileFormValue,
  logoFile: File | null,
  isLogoRemoved: boolean,
): boolean {
  return (
    current.name !== pristine.name ||
    current.email !== pristine.email ||
    current.contactInfo !== pristine.contactInfo ||
    current.description !== pristine.description ||
    current.website !== pristine.website ||
    current.slug !== pristine.slug ||
    current.status !== pristine.status ||
    current.isPublicDirectory !== pristine.isPublicDirectory ||
    current.codeOfConduct !== pristine.codeOfConduct ||
    logoFile !== null ||
    isLogoRemoved
  );
}

export function buildDigestHourOptions(): { utcHour: number; label: string }[] {
  return Array.from({ length: 24 }, (_, i) => {
    const date = new Date();
    date.setUTCHours(i, 0, 0, 0);
    const localHour = date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    return { utcHour: i, label: localHour };
  });
}

export function normalizeVettingQuestionsForSave(questions: VettingQuestionFormValue[]): {
  id: string;
  question: string;
  type: 'text' | 'long_text' | 'boolean' | 'select' | 'checkbox';
  required: boolean;
  options?: string[];
}[] {
  return questions.map((q) => {
    const options = q.optionsString
      ? q.optionsString
          .split(',')
          .map((s) => s.trim())
          .filter((s) => !!s)
      : (q.options ?? []);

    return {
      id: q.id || crypto.randomUUID(),
      question: q.question,
      type: q.type as 'text' | 'long_text' | 'boolean' | 'select' | 'checkbox',
      required: q.required,
      options: options.length > 0 ? options : undefined,
    };
  });
}

export function addVettingQuestion(
  questions: VettingQuestionFormValue[],
): VettingQuestionFormValue[] {
  return [...questions, createEmptyVettingQuestion()];
}

export function removeVettingQuestion(
  questions: VettingQuestionFormValue[],
  index: number,
): VettingQuestionFormValue[] {
  return questions.filter((_, i) => i !== index);
}

export function moveVettingQuestion(
  questions: VettingQuestionFormValue[],
  index: number,
  direction: -1 | 1,
): VettingQuestionFormValue[] {
  const target = index + direction;
  const copy = [...questions];
  if (target < 0 || target >= copy.length) return questions;
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

export function onVettingQuestionTypeChange(
  questions: VettingQuestionFormValue[],
  index: number,
  value: string,
): VettingQuestionFormValue[] {
  questions[index].type = value;
  return [...questions];
}

export function onVettingQuestionFieldChange(
  questions: VettingQuestionFormValue[],
  index: number,
  field: 'question' | 'optionsString',
  value: string,
): VettingQuestionFormValue[] {
  questions[index][field] = value;
  return [...questions];
}

export function onVettingQuestionRequiredChange(
  questions: VettingQuestionFormValue[],
  index: number,
  checked: boolean,
): VettingQuestionFormValue[] {
  questions[index].required = checked;
  return [...questions];
}

export function needsVettingOptions(type: string | undefined): boolean {
  return type === 'select' || type === 'checkbox';
}
