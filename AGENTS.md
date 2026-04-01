# AGENTS.md - Development Guidelines

## Project Overview

**Convocados** is a sports event management application built with:
- **Framework**: Astro 6.x with React 19
- **Database**: Prisma with SQLite (WAL mode, Litestream backups in production)
- **Styling**: Material-UI (MUI)
- **Testing**: Vitest
- **Language**: TypeScript

## Core Principles

### 1. Test-Driven Development (TDD)
All features **must** follow TDD approach:
1. **Write failing tests first** - Define expected behavior before implementation
2. **Implement minimum code** - Write just enough to pass the test
3. **Refactor** - Clean up while keeping tests green

### 2. Code Quality
- Keep code **simple and readable**
- Use meaningful variable/function names
- Prefer small, focused functions over large ones
- Avoid premature optimization
- Comment complex logic, not obvious code

### 3. All Changes Require Tests
Every change must include tests that prove the functionality works:
- New features → New test coverage
- Bug fixes → Regression tests
- Refactoring → Ensure existing tests still pass

## Development Workflow

### First-time setup
After cloning, install the git hooks to catch CI failures before they reach the pipeline:
```bash
npm run setup-hooks
```
This installs a pre-push hook that runs `typecheck` and `vitest --coverage` before every push.

### Branch Naming
```
feat/short-description    # New features
fix/short-description     # Bug fixes
refactor/short-description # Code improvements
```

### Commit Messages
Follow conventional commits:
```
feat: add user authentication
fix: resolve login redirect issue
refactor: simplify event creation logic
test: add tests for player claiming
docs: update AGENTS.md
```

### Pull Request Process
1. Create feature branch from `main`
2. Write failing tests
3. Implement feature
4. Ensure all tests pass (`npm run test`)
5. Run type checking (`npm run typecheck`)
6. Create PR with descriptive title and summary
7. **NEVER merge PRs unless the user explicitly asks to merge** — always wait for explicit confirmation before merging
8. **Before merging**, always run the full test suite (`npm run test`) and type checking (`npm run typecheck`) to ensure the build will succeed in CI/CD

## Testing Guidelines

### Test File Location
- Unit tests: `src/test/*.test.ts` or `src/**/__tests__/*.test.ts`
- Integration tests: `src/test/*.test.ts` (for API routes)

### Test Structure
```typescript
describe("Feature/Component", () => {
  beforeEach(async () => {
    // Reset state, clear database
  });

  it("should do something specific", async () => {
    // Arrange - Set up test data
    // Act - Execute the code under test
    // Assert - Verify expected outcomes
  });
});
```

### Database Tests
- Use the test database (`test.db`)
- Clean up in `beforeEach`:
```typescript
beforeEach(async () => {
  await prisma.model.deleteMany();
  // Reset rate limiters
  resetRateLimitStore();
  resetApiRateLimitStore();
});
```

### Mocking
- Use `vi.fn()` for function mocks
- Use `vi.stubGlobal()` for global mocks
- Always cleanup: `vi.restoreAllMocks()` and `vi.unstubAllGlobals()`

## Code Style

### TypeScript
- Strict mode enabled
- Avoid `any` - use proper types
- Use discriminated unions for state
- Prefer interfaces for object shapes

### React Components
- Functional components with hooks
- Keep components focused on single responsibility
- Extract reusable logic to custom hooks
- Use MUI components for consistency

### API Routes
- Validate input early
- Return proper HTTP status codes
- Use descriptive error messages
- Apply rate limiting for mutations

### Database
- Use Prisma client (`prisma` from `~/lib/db.server`)
- Transactions for related operations
- Index frequently queried fields

## Project Structure

```
src/
├── components/     # React components (.tsx)
├── pages/
│   └── api/         # Astro API routes (.ts)
├── lib/
│   ├── i18n/        # Translations per locale
│   ├── *.server.ts  # Server-side utilities
│   └── *.ts         # Shared utilities
├── test/            # Test files
└── prisma/
    └── schema.prisma
```

## Commands

```bash
# Development
npm run dev          # Start dev server

# Testing
npm run test         # Run all tests
npm run test -- src/test/api.test.ts  # Run specific test file

# Type Checking
npm run typecheck    # Check TypeScript types

# Database
npm run db:generate  # Generate Prisma client
npm run db:migrate   # Run migrations
npm run db:studio    # Open Prisma Studio
```

## Common Patterns

### API Route Handler
```typescript
export const POST: APIRoute = async ({ params, request }) => {
  const limited = rateLimitResponse(request, "write");
  if (limited) return limited;

  const body = await request.json();
  // Validate body
  // Process request
  return Response.json({ ok: true });
};
```

### React Component with i18n
```typescript
import { useT } from "~/lib/useT";

export function MyComponent() {
  const t = useT();
  return <Button>{t("buttonLabel")}</Button>;
}
```

### Adding New i18n Strings
1. Add key to `src/lib/i18n/en.ts` (source of truth)
2. Add translations to all locale files: `pt.ts`, `es.ts`, `fr.ts`, `de.ts`, `it.ts`
3. Use `t("newKey")` in components

## Reviewing Checklist

Before submitting a PR:
- [ ] All tests pass (`npm run test`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] i18n strings added to all 6 locales
- [ ] Database migrations included (if schema changed)
- [ ] Documentation updated (if API changed)
- [ ] No console errors in browser
- [ ] Rate limiting applied to mutations
- [ ] Error responses use appropriate status codes