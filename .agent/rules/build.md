---
trigger: always_on
---

- Always run "npm run build:dev" at the end of your edits and if there is an error fix it.
- Any updates that will trigger too many states and pollute undo history use "HistoryBatcher"
- Never open chrome yourself, I will validate all UI fixes
- If a component is context aware and has only one instance let it jsut use zustand local store directory
- Never worry about backward compatability
- Source Time means the time in video (no gaps), output time is actual time in output after applying windows to source video. we use timeMapper to translate between both
- only react components files start with capital letter. the rest use camelCase