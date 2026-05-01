when in plan mode 

# Skills

Skills serve as living knowledge/memory for this codebase. Whenever you load a skill and notice that the code, types, architecture, or behavior described in the skill no longer matches reality (e.g., a type was renamed, a file moved, a pattern changed), suggest specific edits to bring the skill up to date. **Always ask for permission before making any edits to skill files** — never auto-edit them without confirmation.


# Plans
use actualy meaningful names for plans md files rather than randomly generated names.

# Data Access
No direct table access from the client. All database operations go through RPC (DB functions) or edge functions depending on the need. This keeps the API surface clean and avoids leaking table structure to the frontend.

# Debugging
If the cause of a problem is not obvious, suggest to add logs or reproduce the problem before directly trying to make a fix based on a guess. Once the root cause is confirmed we can fix it. 