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