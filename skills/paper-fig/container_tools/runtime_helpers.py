import json
import os
from pathlib import Path


def _required_runtime_path(env_name: str, *, directory: bool) -> Path:
    raw_value = os.environ.get(env_name)
    if not raw_value:
        raise RuntimeError(f"{env_name} is required.")
    value = Path(raw_value)
    if not value.is_absolute():
        raise RuntimeError(f"{env_name} must be an absolute path.")
    if directory and not value.is_dir():
        raise RuntimeError(f"{env_name} is not a directory: {value}")
    if not directory and not value.is_file():
        raise RuntimeError(f"{env_name} is not a file: {value}")
    return value


def _binary_candidates(bin_dir: Path, name: str) -> tuple[Path, ...]:
    suffixes = (".exe", "") if os.name == "nt" else ("",)
    return tuple(bin_dir / f"{name}{suffix}" for suffix in suffixes)


def runtime_node() -> str:
    node = _required_runtime_path("RUNTIME_NODE", directory=False)
    if os.name != "nt" and not os.access(node, os.X_OK):
        raise RuntimeError(f"RUNTIME_NODE is not executable: {node}")
    return str(node)


def runtime_binary(name: str) -> str:
    bin_dir = _required_runtime_path("RUNTIME_BIN_DIR", directory=True)
    if os.name == "nt":
        manifest_path = bin_dir / "native-executables.json"
        try:
            executable_paths = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(
                f"RUNTIME_BIN_DIR native executable manifest is unavailable: {manifest_path}"
            ) from error

        relative_path = executable_paths.get(name) if isinstance(executable_paths, dict) else None
        if not isinstance(relative_path, str) or Path(relative_path).is_absolute():
            raise RuntimeError(f"RUNTIME_BIN_DIR native executable is missing for {name}")

        native_root = (bin_dir.parent.parent / "native").resolve()
        executable_path = (bin_dir / relative_path).resolve()
        if executable_path.suffix.lower() != ".exe" or not executable_path.is_relative_to(
            native_root
        ):
            raise RuntimeError(
                f"RUNTIME_BIN_DIR native executable for {name} must be a packaged .exe: "
                f"{executable_path}"
            )
        if not executable_path.is_file():
            raise RuntimeError(
                f"RUNTIME_BIN_DIR native executable is not a file for {name}: {executable_path}"
            )
        return str(executable_path)

    for candidate in _binary_candidates(bin_dir, name):
        if candidate.is_file():
            return str(candidate)
    raise RuntimeError(f"RUNTIME_BIN_DIR is missing required binary {name}: {bin_dir}")


def runtime_bin_dir(*required_binaries: str) -> str:
    bin_dir = _required_runtime_path("RUNTIME_BIN_DIR", directory=True)
    if os.name == "nt" and required_binaries:
        native_directories = [Path(runtime_binary(name)).parent for name in required_binaries]
        if len(set(native_directories)) != 1:
            raise RuntimeError(
                "RUNTIME_BIN_DIR required binaries must share the same native directory."
            )
        return str(native_directories[0])

    missing = [
        name
        for name in required_binaries
        if not any(candidate.is_file() for candidate in _binary_candidates(bin_dir, name))
    ]
    if missing:
        raise RuntimeError(
            f"RUNTIME_BIN_DIR is missing required binaries {', '.join(missing)}: {bin_dir}"
        )
    return str(bin_dir)
