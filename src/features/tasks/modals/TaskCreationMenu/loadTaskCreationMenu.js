import NiceModal from '@ebay/nice-modal-react';
import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadTaskCreationMenu = () => measureDynamicModule('task-creation-menu', () => import('./TaskCreationMenu.jsx')).then((module) => module.default);

export async function showTaskCreationMenu(props) {
  const TaskCreationMenu = await loadTaskCreationMenu();
  return NiceModal.show(TaskCreationMenu, props);
}
