#!/usr/bin/env python3
"""Populate Play release notes from a GitHub Release body.

Promotion copies the release notes of the track it promotes *from* (always
`internal`), so writing `internal.txt` once is enough for every later stage.
Markdown is flattened to plain text and truncated to Play's 500-character limit.

Usage: TAG=v3.176.0 python3 play-release-notes.py [module ...]
Modules are directories under android-app (default: app wear).
"""

import os
import pathlib
import subprocess
import sys


def main() -> None:
    tag = os.environ["TAG"]
    modules = sys.argv[1:] or ["app", "wear"]

    body = subprocess.check_output(
        ["gh", "release", "view", tag, "--json", "body", "-q", ".body"],
        text=True,
    )
    lines = [
        line.strip()
        for line in body.splitlines()
        if line.strip()
        and not line.strip().startswith("##")
        and not line.strip().startswith("**Full Changelog**")
    ]
    notes = " ".join(lines)[:500]

    for module in modules:
        out = pathlib.Path(module) / "src/main/play/release-notes/en-US/internal.txt"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(notes, encoding="utf-8")

    print(notes)


if __name__ == "__main__":
    main()
