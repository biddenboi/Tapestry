/* ------------------------------ Time ------------------------------*/

/**
    * Convert milliseconds to HH:MM:SS format
    * @param {number} ms - Time in milliseconds
    * @returns {string} Formatted time (e.g., "01:23:45")
*/
export const timeAsHHMMSS = (ms) => {
    //[CHECK] how method functions
    const totalSeconds = msToSeconds(ms);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    // [Pad with zeros: 5 becomes "05"
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * @param {number} ms - milliseconds to be converted to seconds
 */
export const msToSeconds = (ms) => {
    return Math.floor(ms / 1000);
}

/**
 * @param {number} ms - milliseconds to be converted to points
 */
export const msToPoints = (ms) => {
    return Math.floor(ms / 10000);
}

export const getLocalDateAtMidnight = () => {
    //retrieves swedish time (local) and formats as UTC with truncated time.
    return new Date(new Date().toLocaleString('sv').split(' ')[0] + "T00:00:00");
}

export const getLocalDate = () => {
    //retrieves swedish time (local) and formats as UTC.
    return new Date(new Date().toLocaleString('sv').replace(' ', "T"));
}

/**
 * Converts a Date object in local time to its string representation 
 * @param {Date} s - A date
 */ 
export const formatDateAsLocalString = (date) => {
    return date.toLocaleString('sv').replace(' ', "T");
}


/**
 * Returns a date object the final time elapsed by duration
 * @param {String} s - A String representation of the starting date.
 * @param {number} ms - The amount of milliseconds to add by.
 */ 
export const addDurationToString = (s, ms) => {
    return new Date(new Date(s).getTime() + ms);
}

/**
 * Returns a formatted string of time given a UTC String
 * @param {String} date - A UTC String of the starting datetime.
 */
export function getTimeAsString(date) {
    const time = date.split('T')[1].split('Z')[0];

    const hours = parseInt(time.split(":")[0]);
    let minutes = time.split(":")[1];

    return hours > 12 ? hours % 12 + ":" + minutes + "pm" : 
    hours + ":" + minutes + "am";
}

/* ------------------------------ Player ------------------------------*/

