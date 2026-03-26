export const getTaskDuration = (task) => {
    return new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime();
}

export const getMostUrgent = (todoArray) => {
    //creating object enum to handle sorting
    const difficultyOrder = { hard: 3, medium: 2, easy: 1};

    //SVT returns YYYY-MM-DD
    const todayStr = new Date().toLocaleDateString('sv');
    const dueTodayTasks = todoArray.filter(t => t.dueDate === todayStr);

    if (dueTodayTasks.length > 0) {
        dueTodayTasks.sort((a, b) => (difficultyOrder[b.difficulty] || 0) - (difficultyOrder[a.difficulty] || 0));
       return dueTodayTasks[0];
    } else {
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
        const rng = 1 + Math.random() * 99;
        let remaining = rng;
        let selected = todoArray[todoArray.length - 1];

        for (let i = 0; i < scaled.length; i++) {
          remaining -= scaled[i];
          if (remaining <= 0) {
            selected = todoArray[i];
            break;
          }
        }

        return selected;
    }
}