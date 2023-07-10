import { APIClient, RegionUS } from "customerio-node";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync
} from "fs";
import { youtube_v3 } from "googleapis";
import readline from "readline";
import { YoutubeTranscript } from "youtube-transcript";
import { SupportedLanguages, TranslatedTranscriptPart } from "../types";
import { sendEmail } from "./emails";
import { saveFile } from "./files";
import { removeOldestFromQueue } from "./queue";
import { basicTranslation, getTranslations } from "./translation";
export const fetchVideo = async (videoId: string, download = true) => {
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
          removeOldestFromQueue();
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
          removeOldestFromQueue();
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
          removeOldestFromQueue();
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
        removeOldestFromQueue();
      });
  });

  await promise;
};

export const createTranslatedVideo = async (
  videoId: string,
  language: SupportedLanguages,
  youtube: youtube_v3.Youtube,
  email: string
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

      const publishedVideo = await youtube.videos.insert(
        {
          notifySubscribers: false,
          part: ["snippet", "status"],
          requestBody: {
            snippet: {
              title: newVideoInfo.title,
              description: newVideoInfo.description
            },
            status: {
              privacyStatus: "unlisted"
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

      const emailAPI = new APIClient(process.env.CIO_APP_KEY, {
        region: RegionUS
      });

      sendEmail(emailAPI, {
        email: email,
        video: {
          title: newVideoInfo.title,
          link: `https://www.youtube.com/watch?v=${publishedVideo.data.id}`
        }
      });
      removeOldestFromQueue();
      console.log("\n\n");
    } catch (e) {
      console.log("An error occurred while creating the video:", e);
    }
  });
};
