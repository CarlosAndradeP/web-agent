import type { HLJSApi } from 'highlight.js';

let common: Promise<HLJSApi> | null = null;
let full: Promise<HLJSApi> | null = null;

/** Download all grammars only when a code block needs an uncommon language. */
export async function loadHighlight(language: string): Promise<HLJSApi> {
  common ??= import('highlight.js/lib/common').then(module => module.default).catch(error => {
    common = null;
    throw error;
  });
  const highlighter = await common;
  if (highlighter.getLanguage(language)) return highlighter;
  full ??= import('highlight.js').then(module => module.default).catch(error => {
    full = null;
    throw error;
  });
  return full;
}
