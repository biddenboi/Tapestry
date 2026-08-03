import { restoreTaskRecommenderV12Model } from './TaskRecommenderV12Model.js';
import { trainTaskRecommenderV12Candidate } from './TaskRecommenderV12TrainingCore.js';

self.onmessage = (event) => {
  try {
    const { checkpoint, targetCheckpoint, events, options } = event.data || {};
    const model = restoreTaskRecommenderV12Model(checkpoint);
    const targetModel = restoreTaskRecommenderV12Model(targetCheckpoint || checkpoint);
    const result = trainTaskRecommenderV12Candidate(model, events || [], {
      ...(options || {}),
      targetModel,
    });
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
