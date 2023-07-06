import { ArgumentParser } from "argparse";
import express, { Router } from "express";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "fs";
import { google, youtube_v3 } from "googleapis";
import { Configuration, OpenAIApi } from "openai";
import readline from "readline";
import { YoutubeTranscript } from "youtube-transcript";

require("dotenv").config();

type OpenAiMessage = {
  role: "user" | "system" | "assistant";
  content: string;
};

type TranscriptPart = {
  text: string;
  offset: number;
  duration: number;
};

type TranslatedTranscriptPart = {
  text: string;
  translation: string;
  offset: number;
  duration: number;
};

enum SupportedLanguages {
  ENGLISH = "English",
  SPANISH = "Spanish",
  FRENCH = "French",
  GERMAN = "German"
}

const parser = new ArgumentParser({
  description: "Youtube Transcript Downloader"
});

parser.add_argument("-v", "--videoId", {
  help: "Youtube Video ID",
  required: true
});
parser.add_argument("-l", "--language", {
  help: "Language Code",
  required: true,
  choices: Object.values(SupportedLanguages)
});

const getPrompt = (
  to: SupportedLanguages,
  transcript: TranscriptPart[]
): string => {
  const prompt = `
You are a translator who will be helping me translate the transcript of a video from English to ${to}.

Do not combine any of these lines of the transcript, translate them all separately and return them in the same order. 
When you are done translating, please return the translated transcript in the same format as the original transcript (JSON Array with ${
    transcript.length
  } items).

Here is the original transcript in an array:
[${transcript.map((part) => `"${part.text}"`).join(", ")}]
`;

  return prompt;
};

const saveFile = async (folder: string, fileName: string, data: any) => {
  // cascade check if the folder exists, if not create it for each level
  const folders = folder.split("/");
  let currentFolder = "";
  for (const folder of folders) {
    currentFolder += `${folder}/`;
    if (!existsSync(currentFolder)) {
      mkdirSync(currentFolder);
    }
  }

  await writeFileSync(`${folder}/${fileName}`, JSON.stringify(data));
};

const getTranslations = async (
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

const basicTranslation = async (
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

const fetchVideo = async (videoId: string, download = true) => {
  const ytdl = require("ytdl-core");
  const fs = require("fs");
  if (!existsSync("./videos")) {
    await mkdirSync("./videos");
  }
  if (download) {
    const videoDownload = new Promise((resolve, reject) => {
      ytdl(videoId, {
        quality: "highestvideo",
        filter: (format) => format.container === "mp4"
      })
        .pipe(createWriteStream(`./videos/${videoId}-video.mp4`))
        .on("finish", () => {
          resolve(true);
          console.log("Video Downloaded");
        })
        .on("error", (err) => {
          reject(err);
          console.log("An error occurred while downloading the video:", err);
        });
    });
    const audioDownload = new Promise((resolve, reject) => {
      ytdl(videoId, {
        quality: "highestaudio"
      })
        .pipe(createWriteStream(`./videos/${videoId}.mp3`))
        .on("finish", () => {
          resolve(true);
          console.log("Audio Downloaded");
        })
        .on("error", (err) => {
          reject(err);
          console.log("An error occurred while downloading the audio:", err);
        });
    });
    const promises = Promise.all([videoDownload, audioDownload]);
    await promises;
    // pipe the video and audio into ffmpeg to merge them
    const ffmpeg = require("fluent-ffmpeg");
    const promise = new Promise((resolve, reject) => {
      ffmpeg(`./videos/${videoId}-video.mp4`)
        .addInput(`./videos/${videoId}.mp3`)
        .save(`./videos/${videoId}.mp4`)
        .on("end", () => {
          resolve(true);
          console.log("Video Merged");
          fs.unlinkSync(`./videos/${videoId}-video.mp4`);
          fs.unlinkSync(`./videos/${videoId}.mp3`);
        })
        .on("error", (err) => {
          reject(err);
          console.log("An error occurred while merging the video:", err);
        });
    });
    await promise;
  }
  const videoInfo = await ytdl.getInfo(videoId);

  return videoInfo;
};

const addTranslatedTextToVideo = async (
  videoId: string,
  language: SupportedLanguages,
  translatedParts: TranslatedTranscriptPart[],
  videoDuration: number
) => {
  const ffmpeg = require("fluent-ffmpeg");

  const videoText = translatedParts
    .map((part, index) => {
      const startTime = part.offset / 1000;
      const endTime =
        index + 1 != translatedParts.length
          ? translatedParts[index + 1].offset / 1000
          : videoDuration;
      let text = part.translation;
      if (text == undefined) text = "";

      // sometimes there is a weird bug where it adds a ' to the text, this fixes it
      const escapedText = !text ? text : text.replace(/'/g, "\u2019");
      return `drawtext=font='Open Sans':box=1:boxcolor=black@0.5:fontsize=38:alpha:0.5:fontcolor=white:x=(w-text_w)/2:y=h-th-140:text='${escapedText}':enable='between(t,${startTime},${endTime})'`;
    })
    .join(",");

  if (!existsSync(`./translatedVideos/${language}`)) {
    if (!existsSync("./translatedVideos"))
      await mkdirSync("./translatedVideos");
    await mkdirSync(`./translatedVideos/${language}`);
  }

  const promise = new Promise((resolve, reject) => {
    ffmpeg(`./videos/${videoId}.mp4`)
      .complexFilter([videoText])
      .save(`./translatedVideos/${language}/${videoId}.mp4`)
      .on("end", () => {
        resolve(true);
        console.log("Translated Video Saved");
      })
      .on("error", (err) => {
        reject(err);
        console.log("An error occurred while creating the video:", err);
      });
  });

  await promise;
};

const createTranslatedVideo = async (
  videoId: string,
  language: SupportedLanguages,
  youtube: youtube_v3.Youtube
) => {
  YoutubeTranscript.fetchTranscript(videoId).then(async (transcriptParts) => {
    const textParts = transcriptParts.map((part) => part.text);

    try {
      if (!existsSync(`./translations/${language}/${videoId}.json`)) {
        const translations = await getTranslations(transcriptParts, language);
        const tempTranslatedParts = transcriptParts.map((text, index) => ({
          text: text.text,
          translation: translations[index],
          offset: text.offset,
          duration: text.duration
        }));

        await saveFile(
          `./translations/${language}`,
          `${videoId}.json`,
          tempTranslatedParts
        );
      }

      const translatedParts = JSON.parse(
        readFileSync(`./translations/${language}/${videoId}.json`).toString()
      );
      console.log("Translations Fetched");

      const videoInfo = await fetchVideo(
        videoId,
        !existsSync(`./videos/${videoId}.mp4`)
      );

      console.log("Video Info Retrieved");

      console.log("Creating translated video..");
      await addTranslatedTextToVideo(
        videoId,
        language,
        translatedParts,
        videoInfo.videoDetails.lengthSeconds
      );

      console.log("Translating Title..");
      const translatedTitle = await basicTranslation(
        language,
        videoInfo.videoDetails.title,
        "title"
      );
      console.log("New Title:", translatedTitle);

      console.log("Translating Description..");
      const translatedDescription = await basicTranslation(
        language,
        videoInfo.videoDetails.description,
        "description"
      );
      console.log("New Description:", translatedDescription);

      const newVideoInfo = {
        title: translatedTitle,
        description: translatedDescription,
        videoFile: `./translatedVideos/${language}/${videoId}.mp4`
      };

      console.log("Uploading Video..");

      const fileSize = statSync(newVideoInfo.videoFile).size;

      await youtube.videos.insert(
        {
          notifySubscribers: false,
          part: ["snippet", "status"],
          requestBody: {
            snippet: {
              title: newVideoInfo.title,
              description: newVideoInfo.description
            },
            status: {
              privacyStatus: "private"
            }
          },
          media: {
            body: createReadStream(newVideoInfo.videoFile)
          }
        },
        {
          // Use the `onUploadProgress` event from Axios to track the
          // number of bytes uploaded to this point.
          onUploadProgress: (evt) => {
            const progress = (evt.bytesRead / fileSize) * 100;
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0, null);
            process.stdout.write(`${Math.round(progress)}% complete`);

            if (progress === 100) {
              console.log("\n\n");
              console.log("Video Uploaded");
              console.log("Deleting Video & Files..");
              unlinkSync(newVideoInfo.videoFile);
              unlinkSync(`./translations/${language}/${videoId}.json`);
              unlinkSync(`./videos/${videoId}.mp4`);

              console.log("Video Deleted");
            }
          }
        }
      );
      console.log("\n\n");
    } catch (e) {
      console.log("An error occurred while creating the video:", e);
    }
  });
};

const router = Router();
const app = express();
const port = process.env.PORT;

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URL = process.env.REDIRECT_URL;

const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URL
);

const scope = "https://www.googleapis.com/auth/youtube.upload";

app.get("/", (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope,
    state: JSON.stringify({
      link: req.query.link,
      language: req.query.language
    })
  });
  res.redirect(authUrl);
});

app.get("/google/callback", (req, res) => {
  const code = req.query.code;
  if (code) {
    oAuth2Client.getToken(code.toString(), async (err, token) => {
      if (err) {
        console.log("Error retrieving access token", err);
        return;
      }
      const state = JSON.parse(req.query.state);
      const urlifiedToken = encodeURIComponent(JSON.stringify(token));
      res.redirect(
        `/video?language=${state.language}&link=${state.link}&token=${urlifiedToken}`
      );
    });
  }
});

app.get("/video", async (req, res) => {
  if (!req.query.token)
    return res.send({
      success: false,
      message: "Please login with a valid Google account"
    });

  const token = JSON.parse(decodeURIComponent(req.query.token));

  if (!req.query.link || !req.query.language)
    return res.send({
      success: false,
      message: "Please provide a link and language"
    });

  if (!Object.values(SupportedLanguages).includes(req.query.language))
    return res.send({
      success: false,
      message: "Please provide a valid language"
    });

  const videoId = req.query.link.split("v=")[1];
  if (!videoId)
    return res.send({
      success: false,
      message: "Please provide a valid link"
    });

  // we don't store auth!
  const instanceAuthClient = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URL
  );

  instanceAuthClient.setCredentials(token);

  try {
    const youtube = google.youtube({
      auth: instanceAuthClient,
      version: "v3"
    });
    if (!youtube) {
      console.log("Not logged in!");
      return res.send({
        success: false,
        message: "Please login with a valid Google account"
      });
    }

    res.redirect(process.env.SUCCESS_LINK);

    await createTranslatedVideo(videoId, req.query.language, youtube);
  } catch (e) {
    console.log("Not logged in");
    return res.send({
      success: false,
      message: "Please login with a valid Google account"
    });
  }
});

app.listen(port, () => {
  console.log(`Youtube Translator app listening on port ${port}`);
});
