# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the React + TypeScript frontend. Keep UI in `src/components/`, shared state in `src/store/useStore.ts`, Tauri bridge calls in `src/utils/api.ts`, and shared types in `src/types/`. Static assets live in `public/` and `src/assets/`.

`src-tauri/` contains the desktop backend. Rust entrypoints and commands live under `src-tauri/src/` (`lib.rs`, `commands.rs`, `db/mod.rs`, `speech.rs`). Tauri config is in `src-tauri/tauri.conf.json`; macOS speech permissions and helper binary inputs are in `src-tauri/Info.plist` and `src-tauri/speech_helper.swift`.

## Build, Test, and Development Commands

Run `npm install` to install frontend dependencies.

Run `npm run dev` to start the Vite frontend only.

Run `npm run build` to type-check with `tsc` and produce the frontend bundle in `dist/`.

Run `npm run tauri dev` to launch the full desktop app with the Rust backend.

Run `npm run tauri build` to create a packaged desktop build.

If speech changes require recompiling the helper, use:
```bash
swiftc -sdk /Library/Developer/CommandLineTools/SDKs/MacOSX15.2.sdk \
  -o src-tauri/speech_helper src-tauri/speech_helper.swift \
  -framework Speech -framework AVFoundation
```

## Coding Style & Naming Conventions

Follow the existing style: TypeScript uses 2-space indentation, single quotes, semicolons, and PascalCase component files such as `NoteEditor.tsx`. Hooks, store actions, and helpers use camelCase. Rust uses standard 4-space indentation and snake_case for modules, functions, and command handlers.

Keep components focused. Put cross-component state in Zustand rather than prop-drilling. Add comments only where the control flow is not obvious.

## Testing Guidelines

There is no automated test suite configured yet. Before opening a PR, run `npm run build` and `npm run tauri dev` to verify the frontend bundle, Tauri commands, and desktop startup path. When adding tests, place frontend tests under `src/**/__tests__/` or beside the file as `*.test.ts(x)`, and Rust tests in `src-tauri/src/` with `#[cfg(test)]`.

## Commit & Pull Request Guidelines

Git history is not available in this workspace, so no repository-specific commit convention could be verified. Use short, imperative commit subjects such as `Add folder filtering debounce` and keep unrelated changes separate.

PRs should describe user-visible behavior, list validation steps, and attach screenshots or recordings for UI changes. Call out changes to Tauri permissions, database schema, or the speech helper explicitly.
