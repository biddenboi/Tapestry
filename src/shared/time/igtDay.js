import { DAY } from '@domain/constants.js';
import { getCurrentIGT } from '@domain/time/Time.js';

export function getIgtDayNumber(player) {
  return Math.floor(getCurrentIGT(player) / DAY);
}
