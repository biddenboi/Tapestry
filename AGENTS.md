1. Work on the branch named in the release (release/v0, release/v1), never on main.
2. Do only the steps listed. If a step can't be done as written, stop and ask Peter. Don't improvise.
3. Make one commit per numbered step group, with a message naming the step (for example "R0.3 Gate domain logic").
4. Run npm test after every step group. Never skip, disable or delete a test to get green. If an old test covers code you are told to delete, delete the test together with that code in the same commit, and say so in the message.
5. Use the path aliases: @domain/, @features/, @app/, @data/, @shared/. Domain files are pure (no React, no database). Feature files may use both.
6. Delete, don't disable. Removing a feature means removing its folder, its wiring, and its data through a migration.
7. Files under src/domain/ must not import from src/features/.
8. Never write the whole database anywhere. New data must be small records only.
9. Finish by listing the hand checks from this spec for Peter. He does them, not you.
Changes reach Stable only through the Gate. See docs/releases/README.md.
