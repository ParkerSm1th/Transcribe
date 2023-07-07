import express, { Router } from "express";
import { google } from "googleapis";

import { SupportedLanguages } from "./types";
import { newRequest, queueSize } from "./utils/queue";

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

    res.redirect(`${process.env.SUCCESS_LINK}?queue=${queueSize()}`);

    newRequest({
      videoId,
      language: req.query.language,
      youtube
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
