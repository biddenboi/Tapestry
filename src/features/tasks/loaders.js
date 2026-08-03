import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadTodoList = () => measureDynamicModule(
  'todo-list',
  () => import('./components/TodoList/TodoList.jsx'),
).then((module) => module.default);

export const loadTaskSessionMenu = () => measureDynamicModule(
  'task-session-menu',
  () => import('./modals/TaskSessionMenu/TaskSessionMenu.jsx'),
).then((module) => module.default);

export { loadTaskCreationMenu } from './modals/TaskCreationMenu/loadTaskCreationMenu.js';
export { loadTaskPreviewMenu, showTaskPreviewMenu } from './modals/TaskPreviewMenu/loadTaskPreviewMenu.js';
