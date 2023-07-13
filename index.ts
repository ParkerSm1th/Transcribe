import express, { Router } from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { google } from "googleapis";

import { SupportedLanguages } from "./types";
import { getFormattedQueue, newRequest, queueSize } from "./utils/queue";

require("dotenv").config();

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

const youtubeScope = "https://www.googleapis.com/auth/youtube.upload";
const emailScope = "https://www.googleapis.com/auth/userinfo.email";

app.get("/", (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: emailScope,
    state: JSON.stringify({
      signUp: false,
      link: req.query.link,
      language: req.query.language
    })
  });
  res.redirect(authUrl);
});

app.get("/setup", (req, res) => {
  if (!req.query.language) return res.send("Please provide a language");

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: youtubeScope,
    state: JSON.stringify({
      signUp: true,
      language: req.query.language
    }),
    prompt: "consent"
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
      if (state.signUp) {
        if (!existsSync("./creds")) {
          await mkdirSync("./creds");
        }

        writeFileSync(`./creds/${state.language}.json`, JSON.stringify(token));
        res.send("Setup!");
        return;
      }

      const urlifiedToken = encodeURIComponent(JSON.stringify(token));
      res.redirect(
        `/video?language=${state.language}&link=${state.link}&token=${urlifiedToken}`
      );
    });
  }
});

app.get("/queue", (req, res) => {
  const queue = getFormattedQueue();

  res.send({
    success: true,
    queue
  });
});

app.get("/video", async (req, res) => {
  if (!req.query.token)
    return res.send({
      success: false,
      message: "Please login with a valid Google account"
    });

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

  const authToken = JSON.parse(decodeURIComponent(req.query.token));
  const setupLinkText = `Setup here: https://video-transcription.getmagical.net/setup?language=${req.query.language}`;

  if (!existsSync(`./creds/${req.query.language}.json`)) {
    return res.send({
      success: false,
      message:
        req.query.language + ` channel has not been setup. ${setupLinkText}`
    });
  }
  // we don't store auth!
  const instanceAuthClient = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URL
  );

  let token = JSON.parse(
    readFileSync(`./creds/${req.query.language}.json`).toString()
  );

  instanceAuthClient.setCredentials(token);

  if (token.expiry_date < Date.now()) {
    const newToken = await instanceAuthClient.refreshAccessToken();
    instanceAuthClient.setCredentials(newToken.credentials);
    await writeFileSync(
      `./creds/${req.query.language}.json`,
      JSON.stringify(newToken.credentials)
    );
  }

  const idAuthClient = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URL
  );
  idAuthClient.setCredentials(authToken);

  // decode authToken.id_token in order to get the email
  const decoded = await idAuthClient.verifyIdToken({
    idToken: authToken.id_token,
    audience: CLIENT_ID
  });
  const email = decoded.getPayload()?.email;
  if (!email || !decoded) {
    console.log("Couldn't find email");
    return res.send({
      success: false,
      message: "Please login with a valid Google account"
    });
  }

  if (email.split("@")[1] !== "getmagical.com") {
    console.log("Not a valid email");
    return res.send({
      success: false,
      message: "Please login with a valid Google account"
    });
  }

  try {
    const youtube = google.youtube({
      auth: instanceAuthClient,
      version: "v3"
    });
    if (!youtube) {
      console.log("Couldn't find auth for ", req.query.language);
      return res.send({
        success: false,
        message:
          req.query.language + ` channel has not been setup. ${setupLinkText}`
      });
    }

    res.redirect(`${process.env.SUCCESS_LINK}?queue=${queueSize()}`);

    newRequest({
      videoId,
      language: req.query.language,
      youtube,
      email
    });
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
