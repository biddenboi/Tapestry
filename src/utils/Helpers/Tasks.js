import { DAY } from '../Constants.js';
import { getLocalDate } from './Time.js';

export const getTaskDuration = (task) => {
    return new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime();
}

export const getMostUrgent = (todoArray, weightArray) => {
    //creating object enum to handle sorting
    const difficultyOrder = { hard: 3, medium: 2, easy: 1};

    //SVT returns YYYY-MM-DD
    const today = getLocalDate(new Date());
    const dueTodayTasks = todoArray.filter(t => new Date(t.dueDate).getTime() < today);
    //when a task is pulled it doesn't exist, it reloads the next most urgent without that in the arr.
    //this is a bug, but its fine since we don't want the two same tasks to show up anyways.

    if (dueTodayTasks.length > 0) {
        dueTodayTasks.sort((a, b) => {
          const aDifficulty = difficultyOrder[a.difficulty];
          const bDifficulty = difficultyOrder[b.difficulty];
          
          const aDate = new Date(a.dueDate)
          const bDate = new Date(b.dueDate)

          if (aDate > bDate) return 1;
          if (aDate < bDate) return -1;
          if (aDifficulty > bDifficulty) return -1;
          if (aDifficulty < bDifficulty) return 1;
          return 0;
        });
       return dueTodayTasks[0];
    } else {
        const rng = 1 + Math.random() * 99;
        let remaining = rng;
        let selected = todoArray[todoArray.length - 1];

        for (let i = 0; i < weightArray.length; i++) {
          remaining -= weightArray[i];
          if (remaining <= 0) {
            selected = todoArray[i];
            break;
          }
        }

        return selected;
    }
}

// returns the scaled individual % chance of selection
export const getWeights = (todoArray) => {
  const today = new Date();

  //maybe remove this line so more granular time controls are possible.
  today.setHours(0, 0, 0, 0);
        
  const weights = todoArray.map(t => {
    const dur = parseFloat(t.estimatedDuration) || 0;
    const buf = parseFloat(t.estimatedBuffer) || 0;
    const due = new Date(t.dueDate + 'T00:00:00');

    const daysUntilDue = Math.max((due - today) / DAY, 1);
    return (dur + buf) / daysUntilDue;
  });

  const total = weights.reduce((sum, w) => sum + w, 0);

  if (total === 0) {
    return todoArray[0];
  }

  const scaled = weights.map(w => (w / total) * 100);
  return scaled;
}