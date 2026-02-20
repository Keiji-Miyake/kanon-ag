# Active Features

Last updated: YYYY-MM-DD

## Overview

This directory contains documentation for features currently in development.

## Active Features

| Feature | Status | Priority | Started | Owner | Dependencies |
|---------|--------|----------|---------|-------|--------------|
| [feature-name](./feature-name/) | In Progress | High | 2024-01-01 | @user | - |

## Feature Status Legend

- **Planning**: Requirements gathering and design phase
- **In Progress**: Active development
- **Testing**: Development complete, in testing phase
- **Blocked**: Waiting on dependencies or decisions
- **On Hold**: Paused for prioritization reasons
- **Completed**: Ready for merge/release

## Priority Levels

- **Critical**: Blocking other work or production issues
- **High**: Important for upcoming release
- **Medium**: Scheduled work, not urgent
- Low**: Nice to have, can be deferred

## Feature Dependencies

Document dependencies between features here:

```
feature-a → depends on → feature-b
feature-c → blocks → feature-d
```

## Adding New Features

When starting a new feature:

1. Create directory: `docs/dev/[feature-name]/`
2. Add required docs: SPEC.md, DESIGN.md, CONTEXT.md
3. Register here with status, priority, and dependencies
4. Check ARCHITECTURE.md for alignment
