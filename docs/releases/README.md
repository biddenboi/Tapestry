# Releases

1. Branch release/vN from main.
2. One design note per item at docs/releases/vN/<slug>.md.
3. Build only approved notes.
4. npm test passes.
5. Export a save bundle from Settings.
6. Merge into main and git tag vN.
7. npm run electron:build:mac and install.
8. npm run build then npx wrangler pages deploy dist --project-name tapestry-mobile for the phone.
9. Press Release in the Gate.

Rollback: check out the previous tag, build, install, and import the bundle from step 5.
