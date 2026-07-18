# harness-detect (Python)

Detect installed LLM harnesses (Codex, Claude Code, Gemini CLI, Cursor, and many
others) and resolve their config/state/install paths from a shared JSON
registry.

This is the Python port of `@auron-labs/harness-detect`. It shares the same harness
registry as the TypeScript, Go, and Rust packages and exposes the same API
surface, adapted to idiomatic Python naming.

## Installation

```sh
pip install harness-detect
```

Supported distribution targets are npm (`@auron-labs/harness-detect`), Go modules (`github.com/auron-labs/harness-detect/packages/golang/harnessdetect`, released by `packages/golang/vX.Y.Z` tags), crates.io (`harness-detect`), and PyPI (`harness-detect`). Before the first public release for an ecosystem, these install commands are the intended consumer coordinates and may not resolve yet.

## Usage

```python
from harness_detect import detect_installed_harnesses, CheckOptions

for r in detect_installed_harnesses(CheckOptions()):
    print(r.key, r.reasons)
```

Support metadata is also available:

```python
from harness_detect import get_harness_support, list_harness_support

codex = get_harness_support("codex")
print(codex.support.config.global_.status)
print(len(list_harness_support()))
```

## Exported API

- `get_raw_harness_data()` returns the full registry object.
- `get_harness_matrix()` returns the full registry object.
- `list_harnesses()` returns the registry's harness definitions.
- `get_harness_support(input)` returns support metadata for one harness key or alias.
- `list_harness_support()` returns support metadata for every harness.
- `check_harness(input, options=None)` checks one harness key or alias.
- `detect_harnesses(options=None)` checks every registry entry.
- `detect_installed_harnesses(options=None)` returns only installed harnesses.

See the [package docs](https://github.com/auron-labs/harness-detect) for the full
API reference.
