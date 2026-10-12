//! The model clock: hours since the start of an epoch Lot day.
//!
//! Model day k is Lot day `epoch + k`, so day boundaries fall exactly on the
//! rollover hour. The clock runs on local wall time: on a DST change the
//! affected Lot day still spans 24 model hours, so a session crossing the
//! change is off by at most the shift. Durations logged to the model come
//! from session seconds, not from clock differences, so totals stay exact.

use chrono::{DateTime, Duration, NaiveDate, NaiveDateTime};
use chrono_tz::Tz;
use lot_core::time::{lot_day, resolve_local};

use crate::Hours;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ModelClock {
    pub tz: Tz,
    pub rollover_hour: u32,
    /// Lot day 0 of the model clock.
    pub epoch: NaiveDate,
}

impl ModelClock {
    pub fn new(tz: Tz, rollover_hour: u32, epoch: NaiveDate) -> Self {
        Self { tz, rollover_hour, epoch }
    }

    fn origin(&self) -> NaiveDateTime {
        self.epoch.and_hms_opt(self.rollover_hour, 0, 0).expect("valid rollover hour")
    }

    /// Model hours for an instant.
    pub fn hours(&self, t: &DateTime<Tz>) -> Hours {
        let local = t.with_timezone(&self.tz).naive_local();
        (local - self.origin()).num_milliseconds() as f64 / 3_600_000.0
    }

    /// The instant for model hours (inverse of [`hours`](Self::hours) outside DST gaps).
    pub fn instant(&self, h: Hours) -> DateTime<Tz> {
        let ms = (h * 3_600_000.0).round() as i64;
        resolve_local(self.tz, self.origin() + Duration::milliseconds(ms))
    }

    /// The Lot day containing model hour `h`.
    pub fn day_of(&self, h: Hours) -> NaiveDate {
        self.epoch + Duration::days((h / 24.0).floor() as i64)
    }

    /// Model hours at the start of a Lot day.
    pub fn day_start(&self, d: NaiveDate) -> Hours {
        (d - self.epoch).num_days() as f64 * 24.0
    }

    /// Model day index of the Lot day an instant belongs to.
    pub fn day_index(&self, t: &DateTime<Tz>) -> i64 {
        (lot_day(t, self.rollover_hour) - self.epoch).num_days()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono_tz::America::New_York;

    fn at(y: i32, m: u32, d: u32, h: u32, mi: u32) -> DateTime<Tz> {
        resolve_local(New_York, NaiveDate::from_ymd_opt(y, m, d).unwrap().and_hms_opt(h, mi, 0).unwrap())
    }

    #[test]
    fn days_align_with_lot_days() {
        let c = ModelClock::new(New_York, 4, NaiveDate::from_ymd_opt(2026, 10, 1).unwrap());
        assert_eq!(c.hours(&at(2026, 10, 1, 4, 0)), 0.0);
        assert_eq!(c.hours(&at(2026, 10, 2, 3, 30)), 23.5);
        assert_eq!(c.day_of(23.5), NaiveDate::from_ymd_opt(2026, 10, 1).unwrap());
        assert_eq!(c.day_of(24.0), NaiveDate::from_ymd_opt(2026, 10, 2).unwrap());
        // Every Lot day boundary is a multiple of 24, across the November DST change.
        let t = at(2026, 11, 3, 4, 0);
        assert_eq!(c.hours(&t) % 24.0, 0.0);
        assert_eq!(c.day_index(&t), (c.hours(&t) / 24.0) as i64);
        assert_eq!(c.instant(c.hours(&t)), t);
    }
}
