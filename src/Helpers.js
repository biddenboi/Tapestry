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
 * Returns a date object the final time elapsed by duration
 * @param {String} UTC - A UTC String of the starting date.
 * @param {number} ms - The amount of milliseconds to add by.
 */
export const addDurationToUTCString = (UTC, ms) => {
    return new Date(new Date(UTC).getTime() + ms);
}

/* ------------------------------ Player ------------------------------*/

