import { useChatSpeechStore } from '@/stores/chat-speech-store'

/** Navigation only subscribes to the app-owned player; it never owns playback. */
export function useChatSpeech() {
  return useChatSpeechStore()
}
