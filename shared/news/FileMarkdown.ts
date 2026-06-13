import type { InferDocType } from 'ugly-app/shared';
import { FileMarkdownSchema } from './schemas';

// News stores articles as markdown "files" (a news-scoped subset of
// ugly.bot's File union — only `type: 'markdown'` is ever used).
export type FileMarkdown = InferDocType<typeof FileMarkdownSchema>;

// Simplified like/dislike feedback on a file/article.
export type FileReactionT = 'like' | 'dislike';

export const fileReactionIcons: Record<FileReactionT, string> = {
  like: '\u{1F44D}',
  dislike: '\u{1F44E}',
};
