import NiceModal from '@ebay/nice-modal-react';
import { measureDynamicModule } from '@shared/performance/startupPerf.js';

export const loadTaskPreviewMenu = () => measureDynamicModule('task-preview-menu', () => import('./TaskPreviewMenu.jsx')).then((module) => module.default);

export async function showTaskPreviewMenu(props) {
  const TaskPreviewMenu = await loadTaskPreviewMenu();
  void NiceModal.show(TaskPreviewMenu, props);
  return TaskPreviewMenu;
}
