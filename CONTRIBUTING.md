# Contributing to OpenInterior

Keep changes focused and update documentation when behavior or setup changes.

Before opening a change, run the relevant checks. At minimum, run `pnpm test`,
`pnpm typecheck`, and `pnpm lint`; run the applicable build when changing build
or runtime configuration.

Never commit secrets, API tokens, local environment files, or room photos.
Use `.env.example` only as a non-secret template, and keep real credentials and
personal images outside git.
