import './Stopwatch.css';
import { useState, useEffect } from 'react';
import { timeAsHHMMSS, msToPoints } from '../../Helpers';

/**
 * Visually handles 
 * @param {number} startTime (milliseconds) - when to start stopwatch from.
 * @param {number} durationPenalty - the amount of points penalized. 
*/

function Stopwatch({ startTime, durationPenalty }) {  
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (!startTime) {
      setElapsedTime(0);
      return;
    }

    const interval = setInterval(() => {
      setElapsedTime(Date.now() - startTime);
    }, 1000);

    // Cleanup: clear interval when component unmounts or startTime changes
    return () => clearInterval(interval);
  }, [startTime]);

  return (
    <div className="stopwatch">
      <span>{timeAsHHMMSS(elapsedTime)}</span>
      <span>{msToPoints(elapsedTime) - durationPenalty + " points"}</span>
      <span>{durationPenalty != 0 ? "(-" + durationPenalty + " focus penalty)" : ""}</span>
    </div>
  );
}

export default Stopwatch;