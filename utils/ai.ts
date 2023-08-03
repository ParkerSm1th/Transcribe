import { SupportedLanguages, TranscriptPart } from "../types";

export const getPrompt = (
  to: SupportedLanguages,
  transcript: TranscriptPart[]
): string => {
  const prompt = `
  You are a translator who will be helping me translate the transcript of a video from English to ${to}.
  
  Do not combine any of these lines of the transcript, translate them all separately and return them in the same order. 
  *IMPORTANT*: If you see the word "Magical" do not translate it, it is the name of a company.
  When you are done translating, please return the translated transcript in the same format as the original transcript (JSON Array with ${
    transcript.length
  } items).
  
  Here is the original transcript in an array:
  [${transcript.map((part) => `"${part.text}"`).join(", ")}]
  `;

  return prompt;
};
