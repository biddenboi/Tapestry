# R1 scheduler

R1 is chosen as a product choice: kA = 2 with Module 2 only, shifted repeating starts, and pooled habit pacing. The Rust crate is the source of truth; the JavaScript port must match its fixtures exactly. The reference files retain their Lot repository paths under `reference/` and come from Lot branch `r1`, commit `c363f6e`. Time in that source is fractional hours on a local-day clock; the implementation spec’s statement that Lot uses integer epoch minutes is inconsistent with the reference and requires a product decision before porting.
