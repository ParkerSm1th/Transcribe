import { youtube_v3 } from "googleapis";

export interface OpenAiMessage {
  role: "user" | "system" | "assistant";
  content: string;
}

export interface TranscriptPart {
  text: string;
  offset: number;
  duration: number;
}

export interface TranslatedTranscriptPart {
  text: string;
  translation: string;
  offset: number;
  duration: number;
}

export enum SupportedLanguages {
  ENGLISH = "English",
  SPANISH = "Spanish",
  FRENCH = "French",
  GERMAN = "German",
  THAI = "Thai"
}

export interface QueueRequest {
  videoId: string;
  language: SupportedLanguages;
  youtube: youtube_v3.Youtube;
}
