import { STORES } from '@domain/constants.js';
import DomainRepository from '@data/persistence/repositories/DomainRepository.js';

export class TaskRepository extends DomainRepository {
  constructor(connection) {
    super(connection, {
      domain: 'tasks',
      stores: [
        STORES.task,
        STORES.todo,
        STORES.project,
        STORES.contribution,
        STORES.taskCompletionEvent,
        STORES.taskCompletionReceipt,
      ],
    });
  }
}
export default TaskRepository;
