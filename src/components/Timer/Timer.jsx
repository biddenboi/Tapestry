import './Timer.css';
import { useState, useEffect } from 'react';
import { timeAsHHMMSS, msToPoints } from '../../Helpers';

/**
 * Visually handles 
 * @param {number} startTime (milliseconds) - when to start timer from.
 * @param {number} duration (milliseconds) - how long the timer lasts
 * @param {number} durationPenalty - the amount of points penalized. 
*/

function Timer({ startTime, duration, buffer, durationPenalty }) {  
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

  function getTimerComponent() {
    //convert for concatenation
    const safeDuration = Number(duration) * 60000;
    const safeBuffer = Number(buffer) * 60000;
    const totalSessionDuration = safeDuration + safeBuffer;

    if (safeDuration - elapsedTime > 0) {
      return <span className="in-session">{timeAsHHMMSS(safeDuration - elapsedTime)}</span>
      
    }else if (safeDuration + safeBuffer - elapsedTime > 0) {
      //1 second makes the transition cleaner such that 00:00:00 is entered on red.
      return <span className="in-buffer">{timeAsHHMMSS(safeDuration + safeBuffer - elapsedTime + 1000)}</span>

    }else {
      return <span className="in-overtime">{timeAsHHMMSS(elapsedTime - totalSessionDuration)}</span>
    }
  }

  
  return (
    <div className="timer">
      {getTimerComponent()}
      <span>{msToPoints(elapsedTime) - durationPenalty + " points"}</span>
      <span>{durationPenalty != 0 ? "(-" + durationPenalty + " focus penalty)" : ""}</span>
    </div>
  );
}

export default Timer;