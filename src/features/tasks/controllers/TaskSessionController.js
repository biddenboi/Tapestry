export class TaskSessionController {
  constructor({ completeTask } = {}) {
    if (typeof completeTask !== 'function') {
      throw new Error('TaskSessionController requires the canonical completeTask command.');
    }
    this.completeTask = completeTask;
    this.settlements = new Map();
  }

  settle({ operationId, command } = {}) {
    if (!operationId) throw new Error('Task-session settlement requires a stable operation ID.');
    if (this.settlements.has(operationId)) return this.settlements.get(operationId);
    const settlement = Promise.resolve().then(() => this.completeTask(command));
    this.settlements.set(operationId, settlement);
    settlement.catch(() => {
      if (this.settlements.get(operationId) === settlement) this.settlements.delete(operationId);
    });
    return settlement;
  }
}

export default TaskSessionController;
