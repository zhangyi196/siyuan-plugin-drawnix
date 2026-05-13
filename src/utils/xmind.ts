export type XmindImportFormat = 'opml' | 'markdown';

interface XmindImportFile {
  content: string;
  fileName: string;
  mimeType: string;
  topics: string[];
}

const TEXT_KEYS = new Set([
  'text',
  'content',
  'label',
  'name',
  'title',
]);

const MAX_TOPIC_LENGTH = 300;

function getBaseName(imageURL: string): string {
  const fileName = imageURL.split('/').pop() || '';
  let decoded = fileName;
  try {
    decoded = decodeURIComponent(fileName);
  } catch {
    decoded = fileName;
  }
  return decoded.replace(/\.(svg|png)$/i, '') || 'Drawnix';
}

function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'Drawnix';
}

function normalizeText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyTopicText(value: string): boolean {
  const text = normalizeText(value);
  if (!text) return false;
  if (text.length > MAX_TOPIC_LENGTH) return false;
  if (!/[\p{L}\p{N}]/u.test(text)) return false;
  if (/^data:/i.test(text) || /base64,/i.test(text)) return false;
  if (/^https?:\/\//i.test(text) || /^assets\//i.test(text)) return false;
  if (/^#[0-9a-f]{3,8}$/i.test(text) || /^(rgb|rgba|hsl|hsla)\(/i.test(text)) return false;
  if (/^[\[{]/.test(text)) return false;
  if (/<(svg|mxfile|style|script)\b/i.test(value)) return false;
  if (/^[a-z0-9_-]{24,}$/i.test(text)) return false;
  return true;
}

export function extractFlatTopics(boardData: unknown): string[] {
  const topics: string[] = [];
  const seen = new Set<string>();
  const visited = new WeakSet<object>();

  const collect = (value: unknown) => {
    if (typeof value !== 'string') return;
    if (!isLikelyTopicText(value)) return;

    const text = normalizeText(value);
    if (seen.has(text)) return;

    seen.add(text);
    topics.push(text);
  };

  const walk = (value: unknown, key = '') => {
    if (typeof value === 'string') {
      if (TEXT_KEYS.has(key)) collect(value);
      return;
    }

    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, key));
      return;
    }

    Object.entries(value as Record<string, unknown>).forEach(([entryKey, entryValue]) => {
      if (TEXT_KEYS.has(entryKey)) collect(entryValue);
      walk(entryValue, entryKey);
    });
  };

  walk(boardData);
  return topics;
}

function escapeXML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeMarkdownHeading(value: string): string {
  return value.replace(/^#+\s*/, '').trim() || 'Untitled';
}

function buildOPML(title: string, topics: string[]): string {
  const escapedTitle = escapeXML(title);
  const outlines = topics
    .map((topic) => `      <outline text="${escapeXML(topic)}" />`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapedTitle}</title>
  </head>
  <body>
    <outline text="${escapedTitle}">
${outlines}
    </outline>
  </body>
</opml>
`;
}

function buildMarkdown(title: string, topics: string[]): string {
  const lines = [`# ${escapeMarkdownHeading(title)}`, ''];
  topics.forEach((topic) => {
    lines.push(`## ${escapeMarkdownHeading(topic)}`, '');
  });
  return `${lines.join('\n')}`;
}

export function buildXmindImportFile(
  boardData: unknown,
  imageURL: string,
  format: XmindImportFormat,
): XmindImportFile {
  const title = getBaseName(imageURL);
  const fileBaseName = sanitizeFileName(title);
  const topics = extractFlatTopics(boardData);

  if (format === 'opml') {
    return {
      content: buildOPML(title, topics),
      fileName: `${fileBaseName}.opml`,
      mimeType: 'text/x-opml;charset=utf-8',
      topics,
    };
  }

  return {
    content: buildMarkdown(title, topics),
    fileName: `${fileBaseName}.md`,
    mimeType: 'text/markdown;charset=utf-8',
    topics,
  };
}
