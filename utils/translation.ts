import { Configuration, OpenAIApi } from "openai";
import { OpenAiMessage, SupportedLanguages, TranscriptPart } from "../types";
import { getPrompt } from "./ai";

export const getTranslations = async (
  transcriptParts: TranscriptPart[],
  language: SupportedLanguages
): Promise<string[]> => {
  const openAi = new OpenAIApi(
    new Configuration({
      apiKey: process.env.OPEN_AI_API_KEY,
      organization: process.env.OPEN_AI_ORG
    })
  );

  const messages: OpenAiMessage[] = [
    {
      role: "system",
      content: `You are a helpful assistant who is multi-lingual and only returns JSON arrays of translated text.`
    },
    {
      role: "user",
      content: getPrompt(language, transcriptParts)
    }
  ];

  try {
    console.log("Fetching Translations from OpenAI");
    const response = await openAi.createChatCompletion({
      model: "gpt-4-32k",
      messages: messages,
      max_tokens: 5000,
      temperature: 0.5
    });
    try {
      return JSON.parse(response.data.choices[0].message.content);
    } catch (e) {
      console.log("An error occurred while translating:", e);
    }
  } catch (e) {
    console.log(e);
  }
};

export const basicTranslation = async (
  language: SupportedLanguages,
  stringToTranslate: string,
  type: "title" | "description"
): Promise<string> => {
  const openAi = new OpenAIApi(
    new Configuration({
      apiKey: process.env.OPEN_AI_API_KEY,
      organization: process.env.OPEN_AI_ORG
    })
  );

  const messages: OpenAiMessage[] = [
    {
      role: "system",
      content: `You are a helpful assistant who is multi-lingual and only returns strings of translated text.`
    },
    {
      role: "user",
      content: `Translate the ${type} of this video from English to ${language}, do not give me anything other than the translated text as a string.
        
        Here is the ${type} in English:
        ${stringToTranslate}`
    }
  ];

  try {
    const response = await openAi.createChatCompletion({
      model: "gpt-4",
      messages: messages,
      max_tokens: 5000,
      temperature: 0.5
    });
    try {
      return response.data.choices[0].message.content;
    } catch (e) {
      console.log("An error occurred while translating:", e);
    }
  } catch (e) {
    console.log(e);
  }
};
