export const timeAsHHMMSS = (ms) => {
    const totalSeconds = msToSeconds(ms);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

export const msToSeconds = (ms) => {
    return Math.floor(ms / 1000);
}

export const msToPoints = (ms) => {
    return Math.floor(ms / 10000);
}

export const getMidnightOfDate = (date) => {
    return new Date(date.toLocaleString('sv').split(' ')[0] + "T00:00:00");
}

export const getMidnightInUTC = (date) => {
    const d = new Date(date);
    return new Date(d.toLocaleString('sv').split(' ')[0] + "T00:00:00").toISOString();
}

export const getLocalDate = (date) => {
    return new Date(date.toLocaleString('sv').replace(' ', "T"));
}

export const formatDateAsLocalString = (date) => {
    return date.toLocaleString('sv').replace(' ', "T");
}

export const addDurationToDate = (date, ms) => {
    return new Date(date.getTime() + ms);
}

export function getTimeAsString(date) {
    const time = date.split('T')[1].split('Z')[0];
    const hours = parseInt(time.split(":")[0]);
    let minutes = time.split(":")[1];

    return hours > 12 ? hours % 12 + ":" + minutes + "pm" : 
    hours + ":" + minutes + " am";
}

export function getDateAsString(date) {
    const d = date.split('T')[0];
    return d;
}

export function UTCStringToLocalTime(dateString) {
    return getTimeAsString(formatDateAsLocalString(new Date(dateString)));
}

export function UTCStringToLocalDate(dateString) {
    const date = new Date(dateString); 

    const formattedDate = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    })

    return formattedDate;
}

export const getMsUntilMidnight = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime() - now.getTime();
}