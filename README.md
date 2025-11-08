# V7 Library

TypeScript utility layer that standardises caching, configuration, database access, logging, and eventing for Fooderific services. The library provides a thin façade around common infrastructure (MySQL, Memcached, Vitest) plus abstractions like `DatabaseRecord` so individual microservices can focus on domain logic instead of boilerplate.

## Getting Started

```bash
yarn install
yarn lint
yarn test
```

- `yarn build` – emit compiled JS/typings to `dist/`.
- `yarn lint` – run ESLint with the existing project config.
- `yarn test` – run the fast Vitest suite (unit-level mocks, no external services).
- `yarn test:integration` – spin up disposable MySQL + Memcached containers via Testcontainers and exercise the live adapters (requires Docker).
- `yarn docs` – generate API reference docs under `docs/` using TypeDoc.

> The lint/test scripts assume Node 18+ and Yarn Classic (1.x). When running locally make sure Memcached and MySQL peer dependencies are available if you execute the compiled output in a live environment.

## Key Modules

| Module | Description |
| --- | --- |
| `Cache` (`src/Cache.ts`) | Promise-based Memcached wrapper with singleton management and helpers (`get`, `gets`, `set`, `add`, `cas`, `del`, `flush`). |
| `Configuration` / `ConfigurationBase` | Centralised environment configuration. Projects extend `ConfigurationBase` to override hosts, credentials, logging settings, etc. |
| `DatabasePool` | Lazy MySQL connection pool creator backed by `mysql2/promise`, with helper methods `query`, `execute`, `fetchOne`. |
| `DatabaseRecord` | Rich active-record style base class handling SQL generation, caching, extra table reads, and cache invalidation. |
| `EventBus` | Singleton `EventEmitter` façade for cache invalidation and domain events. |
| `Logger` | Minimal structured logger with pluggable transports (console default). |

### Example Usage

```ts
import {Cache, Configuration, DatabasePool, Logger} from "@fooderific/v7-library";

async function primeUserCache(userId: number) {
  if (!Cache.isEnabled()) return;

  const pool = DatabasePool.getPool();
  const [rows] = await pool.query<{id: number; name: string}[]>(
    "SELECT id, name FROM users WHERE id = ? LIMIT 1",
    [userId],
  );

  const user = rows[0];
  if (user) {
    await Cache.set(`user:${Configuration.CACHE_DOMAIN}:${userId}`, user, 300);
  }
}

const logger = new Logger("orders");
logger.info("Cache primed");
```

See `tests/` for additional examples of how to mock the modules in Vitest.

## Testing Strategy

- **Unit tests** (`yarn test`): reside under `tests/` (excluding `tests/integration/`) and mock all infrastructure for speed/repeatability.
- **Integration tests** (`yarn test:integration`): live in `tests/integration/` and rely on Testcontainers to boot real MySQL/Memcached instances. Requires Docker to be running locally.

Add new unit tests near the relevant module to keep intent obvious. For new integration cases, reuse the container harness to seed data and verify wire-level behaviour.

## Extending the Library

1. Implement new features under `src/`.
2. Export them through `src/index.ts`.
3. Add focused unit tests under `tests/` (matching directory structure helps discoverability).
4. Run `yarn lint && yarn test` before committing.

## Consuming in Other Projects

1. Build this library (`yarn build`) and publish to your private registry or reference via a Git tag.
2. In consuming services:
   ```bash
   yarn add @fooderific/v7-library
   ```
3. Extend `ConfigurationBase` to provide environment-specific values.
4. Use `DatabaseRecord` subclasses to encapsulate table logic and rely on `Cache`, `Logger`, and `EventBus` for shared concerns.

Keeping the abstractions in one place makes it easier to roll out changes (e.g., logging transports, cache behaviour) across multiple services with a single version bump.

## API Reference

- Build the HTML reference locally with `yarn docs`. The output lives in `docs/` (served statically from any HTTP server or opened directly in a browser).
- TypeDoc reads the in-source TSDoc comments, so updating the comments automatically keeps the reference in sync.
