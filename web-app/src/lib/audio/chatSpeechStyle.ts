export function stripChatSpeechStyles(text: string) {
  return text.replace(/\[\[voice:[^\]\n]*(?:\]\]|\]?$)/gi, '')
}
