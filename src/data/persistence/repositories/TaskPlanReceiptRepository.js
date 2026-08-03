import { STORES } from '../../../domain/constants.js';

export class TaskPlanReceiptRepository {
  constructor(facade) {
    if (!facade?.getPlayerStore || !facade?.add) {
      throw new Error('TaskPlanReceiptRepository requires the canonical database facade.');
    }
    this.facade = facade;
  }

  list(playerUUID) {
    return this.facade.getPlayerStore(STORES.taskPlanReceipt, String(playerUUID));
  }

  async getActive(playerUUID, taskUUID) {
    return (await this.list(playerUUID)).find((receipt) => (
      receipt.status === 'active' && String(receipt.taskUUID) === String(taskUUID)
    )) || null;
  }

  save(receipt) {
    return this.facade.add(STORES.taskPlanReceipt, receipt).then(() => receipt);
  }
}

export default TaskPlanReceiptRepository;
