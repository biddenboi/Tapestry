export const TASK_RECOMMENDER_V12_ACTIVE_ENTRY_PATHS = Object.freeze([
  'main.jsx',
  'domain/tasks/TaskRecommender.js',
  'domain/tasks/TaskRecommendationV12.js',
  'domain/tasks/TaskRecommenderV12Training.js',
  'domain/tasks/TaskRecommenderV12Lifecycle.js',
  'domain/tasks/TaskRecommenderV12PolicyRegistry.js',
  'domain/tasks/TaskRecommenderV12Evidence.js',
  'features/settings/pages/Settings/Settings.jsx',
]);

export const TASK_RECOMMENDER_V12_REMOVED_RUNTIME_PATHS = Object.freeze([
  'domain/tasks/TaskRecommenderBootstrap.js',
  'domain/tasks/TaskRecommenderModel.js',
  'domain/tasks/TaskRecommenderState.js',
  'domain/tasks/TaskRecommenderTraining.js',
  'domain/tasks/TaskRecommenderTrainingModel.js',
  'domain/tasks/TaskRecommenderTrainingWorker.js',
  'domain/tasks/TaskRecommenderV12Experiments.js',
  'domain/tasks/TaskRecommenderV12Evaluation.js',
  'domain/tasks/TaskRecommenderV12Promotion.js',
]);


export const TASK_RECOMMENDER_V12_REMOVED_OBSOLETE_PATHS = Object.freeze([
  'V12_RECOMMENDER_CUTOVER.md',
  'domain/tasks/TaskRecommenderV11RuntimeInventory.js',
  'domain/tasks/TaskRecommenderV11RuntimeInventory.test.mjs',
]);
