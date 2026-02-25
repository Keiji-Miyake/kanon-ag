# Contributing to Kanon

Thank you for your interest in contributing! This document provides guidelines for contributing to the Kanon orchestration CLI.

## Getting Started

1. Fork this repository
2. Clone your fork: `git clone https://github.com/Keiji-Miyake/kanon-ag.git`
3. Create a branch: `git checkout -b feat/my-feature`
4. Install dependencies: `npm install`

## Development

### Build

```bash
# Build CLI
npm run build:cli

# Build VS Code extension
npm run build:extension

# Build all
npm run build
```

### Test

```bash
# Run unit tests (Vitest)
npm run test:unit
```

### Project Structure

See [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for detailed architecture documentation.

```tree
src/
├── cli/            # CLI entry point, agent runner, config loader
├── domain/         # Pure business logic (no external deps)
├── usecases/       # Orchestration & prompt use cases
├── infrastructure/ # External integrations (Git, Redis, etc.)
└── extension/      # VS Code extension (Antigravity Dashboard)
tests/              # Vitest unit tests (mirrors src/ structure)
skills/             # Agent skill definitions (SKILL.md files)
```

## Pull Request Process

1. Ensure your changes pass all builds and tests
2. Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages
3. Write a clear PR description explaining:
   - What the change does
   - Why it is needed
   - How it was tested

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on quality and maintainability
- Help others learn and improve

## Questions?

Open an issue if you have questions or need help!

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
