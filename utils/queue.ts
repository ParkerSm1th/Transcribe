import { QueueRequest } from "../types";
import { createTranslatedVideo } from "./video";

const currentQueue: QueueRequest[] = [];

const addToQueue = (request: QueueRequest) => {
  currentQueue.push(request);
  if (currentQueue.length === 1) nextQueueAction();
};

const delayedQueueAction = (request: QueueRequest) => {
  console.log("Running queue item", request.language, request.videoId);
  setTimeout(() => {
    removeOldestFromQueue();
  }, 1000 * 10);
};

const nextQueueAction = () => {
  if (currentQueue.length === 0) return;
  const next = currentQueue[0];

  //   delayedQueueAction(next);
  createTranslatedVideo(next.videoId, next.language, next.youtube);
};

export const removeOldestFromQueue = () => {
  currentQueue.shift();
  nextQueueAction();
};

export const newRequest = (request: QueueRequest) => {
  addToQueue(request);
};

export const queueSize = () => currentQueue.length;
