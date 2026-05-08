export type HelpAccessLevel = 'public' | 'authenticated' | 'community_admin' | 'root_admin';

export type HelpSection = 'users' | 'admins' | 'developers';

export interface HelpArticle {
  slug: string;
  path?: string;
  title: string;
  category: string;
  order: number;
  categoryOrder?: number | null;
  description: string;
  access?: HelpAccessLevel;
  section: HelpSection;
  body: string;
  isCategoryIndex?: boolean;
}

export interface HelpCategory {
  name: string;
  articles: HelpArticle[];
  indexArticle?: HelpArticle;
  order: number;
}

export interface HelpSearchResult {
  article: HelpArticle;
  snippet: string;
}
