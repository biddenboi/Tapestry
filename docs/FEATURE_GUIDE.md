# Feature Guide

This guide is for adding or changing features without blurring app, data, domain, shared, and feature boundaries.

## Add A New Feature

1. Create src/features/<feature-name>/.
2. Add screen code under pages/ or components/ depending on whether the entry is a full panel or a reusable feature-local component.
3. Add feature modals under modals/.
4. Add feature-local view builders under model/ when the logic is tied to UI shape.
5. Add browser or database orchestration under services/ when it is not a pure domain rule.
6. Add styles under styles/ or colocated CSS next to the component if that is the local pattern.
7. Export only public screen loader functions, modal loaders, or small helper entrypoints from src/features/<feature-name>/index.js.
8. Register the feature in src/app/shell/GameHub/GameHub.jsx if it is a panel or shell action.

Feature internals can import sibling files directly. Other features and the app shell should import from the feature index.

## Add A Store Or Save Field

1. Add or extend the store constant in src/domain/constants.js if the field is a domain-level collection.
2. Update src/data/db/saveBundleFormat.js with the durable file path or manifest behavior.
3. Update src/data/db/saveBundleUtils.js if parsing, serialization, markdown conversion, resources, or zip path handling changes.
4. Update DatabaseConnection only for app-facing read/write APIs.
5. Add a regression test under src/data/db or the relevant domain folder.
6. Update docs/PERSISTENCE.md with the folder path, validation rule, import/export behavior, and migration default.

Do not store canonical app records in browser storage. Browser storage may hold only source-handle cache state required by the File System Access API.

## Add A Modal

1. Place the modal in the owning feature's modals/ folder.
2. Use shared ModalFrame, ActionRow, ConfirmDialog, FormField, StatusBadge, or other shared UI where possible.
3. Export the modal from the feature index only when another feature or the app shell must open it.
4. Keep modal side effects explicit: save through databaseConnection, refreshApp after changes, and notify only when the user-facing action deserves it.

## Add A Panel

1. Create a screen entrypoint in the feature folder.
2. Export a screen loader from the feature index, for example loadProfile or loadFeed.
3. Add it to GameHub's lazy panel imports and panel rendering switch.
4. Add sidebar or drawer navigation only if it is a first-class area.
5. Keep panel loading and error states inside the shell or feature boundary, not scattered through callers.

## Add Map Behavior

Put projection, distance, interpolation, location normalization, and gym clustering rules under src/domain/map with Node tests. Keep Leaflet-specific rendering in src/features/world-map. Do not store viewport state on profile records; use app settings for UI viewport state and domain records only for captured action locations.

## Add Domain Logic

1. Put pure rules in src/domain/<area>/.
2. Keep React imports out of domain modules.
3. Pass inputs explicitly instead of reading app context.
4. Prefer deterministic functions for scoring, projections, ranking, and checks.
5. Add .test.mjs coverage next to the module when the rule affects persistence, IGT, matching, ranking, economy, or achievements.

## Add Shared UI Or Helpers

Use src/shared for code that is not owned by one product area. Shared UI should be general enough for multiple features. If a component references domain-specific copy, app-specific data shape, or one screen's layout, keep it in that feature.

Global design tokens and base layout CSS live in src/shared/styles/. Reusable component CSS can live next to the component or inside src/shared/ui/ when it is part of the shared UI system.

## Add Tests

Use Node's built-in test runner for domain and data helpers. Keep tests small and deterministic. Tests that import source through data URLs must replace Vite aliases with local stubs because Node cannot resolve Vite aliases inside generated data URLs.

Recommended commands:

    node --test src/**/*.test.mjs
    npm run build

Run both after move-heavy or persistence-heavy changes.

## Import Rules

- @app: app shell, context, app-level hooks, providers.
- @data: DatabaseConnection and persistence utilities.
- @domain: pure rules, constants, projections, ranking, scoring.
- @features: feature public exports and feature-local private imports.
- @shared: reusable UI, hooks, icons, resource helpers, markdown/media utilities, global styles.

Avoid upward relative paths between top-level areas. Prefer aliases for clarity.
