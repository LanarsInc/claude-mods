"""Weighs the Claude Code replies in the transcripts, minute by minute.

Usage: weigh.py FROM_MS TO_MS

Reads every transcript under the Claude config folder's projects/ that changed
since FROM_MS and prints {"<minute start ms>": weight} for the replies sent in
[FROM_MS, TO_MS), as JSON. A reply's weight is its tokens priced against each
other the way the API prices them (output five times input, a cache write 1.25
or 2 times, a cache read a tenth); every model counts alike. A reply written
on several lines, one per content block, counts once.
"""

import json
import os
import sys
from datetime import datetime

MINUTE = 60_000


def weight(usage):
    written = usage.get("cache_creation_input_tokens") or 0
    hour_long = (usage.get("cache_creation") or {}).get("ephemeral_1h_input_tokens") or 0

    return (
        (usage.get("input_tokens") or 0)
        + 1.25 * (written - hour_long)
        + 2 * hour_long
        + 0.1 * (usage.get("cache_read_input_tokens") or 0)
        + 5 * (usage.get("output_tokens") or 0)
    )


def main():
    start, end = int(sys.argv[1]), int(sys.argv[2])
    config = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    seen = set()
    minutes = {}
    for folder, _, names in os.walk(os.path.join(config, "projects")):
        for name in names:
            path = os.path.join(folder, name)
            try:
                if not name.endswith(".jsonl") or os.path.getmtime(path) * 1000 < start:
                    continue
                with open(path, encoding="utf-8", errors="replace") as lines:
                    for line in lines:
                        if '"assistant"' not in line or '"usage"' not in line:
                            continue
                        try:
                            row = json.loads(line)
                            message = row["message"]
                            at = datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))
                        except (ValueError, KeyError, TypeError, AttributeError):
                            continue
                        key = message.get("id") or row.get("requestId")
                        ms = int(at.timestamp() * 1000)
                        if row.get("type") != "assistant" or key in seen or not start <= ms < end:
                            continue
                        seen.add(key)
                        minute = str(ms - ms % MINUTE)
                        minutes[minute] = minutes.get(minute, 0) + weight(message.get("usage") or {})
            except OSError:
                continue
    json.dump(minutes, sys.stdout)


main()
