# R1 scheduler

R1 is chosen as a product choice: kA = 2 with Module 2 only, shifted repeating starts, and pooled habit pacing. The Rust crate is the source of truth; the JavaScript port must match its fixtures exactly. The reference files retain their Lot repository paths under `reference/` and come from Lot branch `r1`, commit `c363f6e`. Peter approved preserving Lot’s fractional hours and local-day clock on October 12, 2026; dates are converted at the application boundary. Numeric fixture comparisons use the same 1e-6 relative tolerance as Lot, including every alert field.
