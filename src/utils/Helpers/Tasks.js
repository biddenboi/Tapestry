export const getTaskPoints = () => {
    //might remove and replace its calls with just msToPoints(getTaskDuration());
    const duration = getTaskDuration();
    return Math.floor(msToPoints(duration));
}

export const getTaskDuration = (task) => {
    return new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime();
}
