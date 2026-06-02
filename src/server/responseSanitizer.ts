const trailingPunctuationPattern = /[),.;:!?]+$/;
const urlProtocolPattern = /^https?:\/\//i;

function shortenPathForSpeech(value: string): string {
  const trailingPunctuation = value.match(trailingPunctuationPattern)?.[0] ?? "";
  const pathWithoutTrailingPunctuation = trailingPunctuation
    ? value.slice(0, -trailingPunctuation.length)
    : value;

  const normalizedPath = pathWithoutTrailingPunctuation.replace(/\\/g, "/");
  const pathParts = normalizedPath.split("/").filter(Boolean);
  const filename = pathParts[pathParts.length - 1];

  return filename ? `${filename}${trailingPunctuation}` : value;
}

function shortenUrlForSpeech(value: string): string {
  const trailingPunctuation = value.match(trailingPunctuationPattern)?.[0] ?? "";
  const urlWithoutTrailingPunctuation = trailingPunctuation
    ? value.slice(0, -trailingPunctuation.length)
    : value;

  try {
    const url = new URL(urlWithoutTrailingPunctuation);
    return `${url.hostname.replace(/^www\./i, "")}${trailingPunctuation}`;
  } catch {
    return value;
  }
}

export function sanitizeResponseForSpeech(text: string): string {
  return text
    .replace(/\[([^\]\r\n]+)\]\(https?:\/\/[^)\s]+\)/gi, "$1")
    .replace(/\[([^\]\r\n]+)\]\((?:[A-Za-z]:\/|\/|\\\\)[^)]+\)/g, "$1")
    .replace(/`(https?:\/\/[^`\s]+)`/gi, (_, url: string) => shortenUrlForSpeech(url))
    .replace(/`((?:[A-Za-z]:\\|\\\\)[^`\r\n]+?)`/g, (_, path: string) => shortenPathForSpeech(path))
    .replace(/`(\/(?:[^/`\r\n]+\/)+[^`\r\n]+?)`/g, (_, path: string) => shortenPathForSpeech(path))
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => shortenUrlForSpeech(url))
    .replace(/\b(?:[A-Za-z]:\\|\\\\)[^\s"'<>|]+/g, (path) => shortenPathForSpeech(path))
    .replace(/(^|[\s(])\/(?:[^\s"'<>|]+\/)+[^\s"'<>|]+/g, (match, prefix: string) => {
      const path = match.slice(prefix.length);
      return `${prefix}${shortenPathForSpeech(path)}`;
    })
    .replace(urlProtocolPattern, "");
}

export const sanitizeResponseForVoice = sanitizeResponseForSpeech;
export const sanitizeTextForSpeech = sanitizeResponseForSpeech;
export const sanitizeForSpeech = sanitizeResponseForSpeech;
export const sanitizeAssistantResponse = sanitizeResponseForSpeech;
export const sanitizeAssistantResponseForAudio = sanitizeResponseForSpeech;
export const sanitizeAssistantResponseForSpeech = sanitizeResponseForSpeech;
export const sanitizeResponse = sanitizeResponseForSpeech;

export default sanitizeResponseForSpeech;
