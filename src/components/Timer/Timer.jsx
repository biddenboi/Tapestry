import './Timer.css';
import { useState, useEffect } from 'react';
import { timeAsHHMMSS, msToPoints } from '../../utils/Helpers/Time';
import { SECOND } from '../../utils/Constants';

/**
 * Visually handles 
 * @param {number} startTime (milliseconds) - when to start timer from.
 * @param {number} duration (milliseconds) - how long the timer lasts
*/

function Timer({ showPoints, startTime, duration }) {  
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
    const safeDuration = duration ? Number(duration) * 60000 : 0;
    const difference = safeDuration - elapsedTime;

    return <span className={difference > 0 ?  "in-session" : "in-overtime"}>
      {timeAsHHMMSS(difference > 0 ? Math.abs(difference) : Math.abs(difference)+SECOND)}</span>
  }

  
  return (
    <div className="timer">
      {getTimerComponent()}
      {showPoints ? 
        <span>{msToPoints(elapsedTime) /**- durationPenalty*/ + " points"}</span> :""
      }
    </div>
  );
}

export default Timer;