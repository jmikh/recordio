# Step 7: Folder Restructuring Plan

## Goal
Reorganize the codebase into 3 main directories:
1. **`webapp/`** - The hosted editor website
2. **`extension/`** - The Chrome extension (recording only)
3. **`shared/`** - Code shared between webapp and extension

## Current Structure Analysis

```
recordio/
├── src/
│   ├── assets/           → shared (logo, branding)
│   ├── auth/             → webapp (authentication)
│   ├── components/ui/    → shared (Button, Slider, etc.)
│   ├── core/             → webapp (editor logic, painters, mappers)
│   ├── editor/           → webapp (editor UI)
│   ├── editor-web/       → webapp (website pages)
│   ├── extension/        → (currently empty, unused)
│   ├── recording/        → extension (popup, background, content)
│   ├── shared/           → shared (types, components)
│   ├── storage/          → extension (temp storage for recording)
│   ├── theme/            → shared (theme constants)
│   ├── utils/            → shared (sentry, colors)
│   ├── index.css         → shared (global styles)
│   └── vite-env.d.ts     → root
├── public/
│   ├── assets/           → webapp (backgrounds, icons)
│   ├── icons/            → extension (extension icons)
│   ├── wasm/             → webapp (transcription WASM)
│   └── vite.svg          → delete
├── manifest.json         → extension
├── vite.config.ts        → extension
├── vite.config.editor-web.ts → webapp
└── ...
```

## Proposed New Structure

```
recordio/
├── webapp/                          # Hosted editor website
│   ├── src/
│   │   ├── App.tsx                  # from editor-web/App.tsx
│   │   ├── main.tsx                 # from editor-web/main.tsx
│   │   ├── pages/                   # from editor-web/pages/
│   │   │   ├── DashboardPage.tsx
│   │   │   ├── EditorPage.tsx
│   │   │   └── ImportPage.tsx
│   │   ├── editor/                  # from src/editor/
│   │   │   ├── App.tsx              # Main editor component
│   │   │   ├── components/
│   │   │   ├── stores/
│   │   │   ├── hooks/
│   │   │   └── ...
│   │   ├── core/                    # from src/core/
│   │   │   ├── Project.ts
│   │   │   ├── painters/
│   │   │   ├── mappers/
│   │   │   └── ...
│   │   ├── storage/                 # from editor-web/storage/
│   │   │   ├── projectStorage.ts
│   │   │   └── ProjectStorageCompat.ts
│   │   ├── hooks/                   # from editor-web/hooks/
│   │   │   └── useExtensionBridge.ts
│   │   ├── auth/                    # from src/auth/
│   │   └── index.css                # webapp-specific styles
│   ├── public/                      # Webapp static assets
│   │   ├── assets/                  # backgrounds
│   │   └── wasm/                    # transcription models
│   ├── index.html                   # from editor-web/index.html
│   └── vite.config.ts               # from vite.config.editor-web.ts
│
├── extension/                       # Chrome extension (thin client)
│   ├── src/
│   │   ├── popup/                   # from recording/popup/
│   │   ├── background/              # from recording/background/
│   │   ├── content/                 # from recording/content/
│   │   ├── offscreen/               # from recording/offscreen/
│   │   ├── controller/              # from recording/controller/
│   │   ├── shared/                  # from recording/shared/
│   │   └── storage/                 # from src/storage/ (temp recording storage)
│   ├── public/
│   │   └── icons/                   # extension icons
│   ├── manifest.json
│   └── vite.config.ts               # from root vite.config.ts
│
├── shared/                          # Shared code
│   ├── types/                       # from shared/types/
│   │   ├── index.ts
│   │   ├── bridge.ts
│   │   ├── recording.ts
│   │   └── events.ts
│   ├── components/                  # from shared/components/
│   │   └── ui/                      # shared UI components
│   ├── styles/                      # from shared/styles/
│   ├── theme/                       # from src/theme/ and shared/theme/
│   ├── assets/                      # from src/assets/ (logo)
│   └── utils/                       # from src/utils/
│       ├── sentry.ts
│       └── colors.ts
│
├── package.json                     # Workspaces config
├── tsconfig.json                    # Base tsconfig
├── tailwind.config.js               # Shared Tailwind config
└── ...
```

## Migration Steps

### Phase A: Preparation
- [ ] A.1 Create directory structure: `webapp/`, `extension/`, `shared/`
- [ ] A.2 Set up npm workspaces in package.json
- [ ] A.3 Create base tsconfig for shared imports

### Phase B: Move Shared Code
- [ ] B.1 Move `src/shared/` → `shared/`
- [ ] B.2 Move `src/components/ui/` → `shared/components/ui/`
- [ ] B.3 Move `src/theme/` → `shared/theme/`
- [ ] B.4 Move `src/utils/` → `shared/utils/`
- [ ] B.5 Move `src/assets/` → `shared/assets/`
- [ ] B.6 Update all imports to use `@shared/` alias

### Phase C: Move Extension Code
- [ ] C.1 Move `src/recording/` → `extension/src/`
- [ ] C.2 Move `src/storage/` → `extension/src/storage/`
- [ ] C.3 Move `manifest.json` → `extension/`
- [ ] C.4 Move `vite.config.ts` → `extension/`
- [ ] C.5 Move `public/icons/` → `extension/public/icons/`
- [ ] C.6 Update vite.config.ts paths
- [ ] C.7 Update manifest.json paths

### Phase D: Move Webapp Code
- [ ] D.1 Move `src/editor-web/` → `webapp/src/`
- [ ] D.2 Move `src/editor/` → `webapp/src/editor/`
- [ ] D.3 Move `src/core/` → `webapp/src/core/`
- [ ] D.4 Move `src/auth/` → `webapp/src/auth/`
- [ ] D.5 Move `vite.config.editor-web.ts` → `webapp/vite.config.ts`
- [ ] D.6 Move `public/assets/` → `webapp/public/assets/`
- [ ] D.7 Move `public/wasm/` → `webapp/public/wasm/`
- [ ] D.8 Update all imports

### Phase E: Update Build Configuration
- [ ] E.1 Update package.json scripts for workspaces
- [ ] E.2 Update tsconfig paths for all projects
- [ ] E.3 Update Tailwind config paths
- [ ] E.4 Test extension build
- [ ] E.5 Test webapp build

### Phase F: Cleanup
- [ ] F.1 Remove old `src/` directory
- [ ] F.2 Update README documentation
- [ ] F.3 Update .gitignore
- [ ] F.4 Verify all builds work

## Import Alias Strategy

| Alias | Path | Used By |
|-------|------|---------|
| `@shared` | `shared/` | Both |
| `@webapp` | `webapp/src/` | Webapp only |
| `@extension` | `extension/src/` | Extension only |
| `@editor` | `webapp/src/editor/` | Webapp only |
| `@core` | `webapp/src/core/` | Webapp only |

## Risks & Considerations

1. **Many files to update** - This is a large refactor
2. **Build configs** - Both Vite configs need careful updates
3. **Circular dependencies** - Need to ensure clean separation
4. **Testing** - Must verify both projects build and run after each phase

## Files to Delete After Migration

- `src/` directory (all content moved)
- `src/extension/` (was empty)
- `public/vite.svg` (unused)
- `public/repro_scroll.html` (test file)

## Estimated Effort

- Phase A: 15 min
- Phase B: 30 min
- Phase C: 30 min
- Phase D: 45 min
- Phase E: 30 min
- Phase F: 15 min

**Total: ~2.5-3 hours**

---

## Ready to Proceed?

This plan creates a clean separation:
- **webapp/** - Everything users see on the website
- **extension/** - Minimal recording-only extension
- **shared/** - Types, components, utilities used by both

Would you like me to proceed with Phase A (create directory structure)?
