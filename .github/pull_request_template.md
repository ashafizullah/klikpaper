## What and why

<!-- What does this change, and why? Link the issue it fixes, e.g. "Fixes #12". -->

## How to test

<!-- Steps a reviewer can follow to see the change. Add a screenshot or short clip for UI changes. -->

## Checklist

- [ ] `bun run check` and `bun run build` pass
- [ ] `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` pass in `src-tauri`
- [ ] `bun run test` passes, and `bun run notices` passes after dependency changes
- [ ] All code in this PR is my own or comes from a dependency under its license (no copied code from other repositories or unmerged upstream PRs)
- [ ] Claims in the description and README match what I tested
- [ ] I've read [CONTRIBUTING.md](https://github.com/ashafizullah/klikpaper/blob/main/CONTRIBUTING.md)
