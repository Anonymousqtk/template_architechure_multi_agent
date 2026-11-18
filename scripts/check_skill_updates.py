#!/usr/bin/env python3
"""Read-only official upstream release/commit checker. NO skill download or execution."""
import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def fetch_json(url, token=None):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "ManagerHR-Skill-Watch/1", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)

def check_one(item, fetch=fetch_json, token=None):
    repo = item["repository"]
    if not (repo.count("/") == 1 and all(s.replace("-", "").replace("_", "").replace(".", "").isalnum() for s in repo.split("/"))):
        raise ValueError("Invalid repository identifier")
    if item["tracking"] == "release":
        data = fetch(f"https://api.github.com/repos/{repo}/releases/latest", token)
        current = data["tag_name"]
        url = data["html_url"]
        if data.get("draft") or data.get("prerelease"):
            return {"id": item["id"], "status": "ignored-prerelease"}
    elif item["tracking"] == "commit":
        branch = item.get("branch", "main")
        if not branch.replace("-", "").replace("_", "").isalnum():
            raise ValueError("Invalid branch")
        data = fetch(f"https://api.github.com/repos/{repo}/commits/{branch}", token)
        current = data["sha"]
        url = data["html_url"]
    else:
        raise ValueError("Unknown tracking mode")
    approved = item.get("approved_ref")
    return {"id": item["id"], "repository": repo, "approved_ref": approved, "latest_ref": current, "url": url, "status": "needs-baseline" if not approved else "current" if current == approved else "update-available"}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(ROOT / "policy/upstream-watch.json"))
    ap.add_argument("--output", default=str(ROOT / "skill-update-report.json"))
    args = ap.parse_args()
    cfg = json.loads(Path(args.config).read_text())
    ids = [i["id"] for i in cfg["repositories"]]
    if len(set(ids)) != len(ids):
        raise SystemExit("Duplicate IDs")
    results = []
    for item in cfg["repositories"]:
        try:
            result = check_one(item, token=os.getenv("GITHUB_TOKEN"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, KeyError, ValueError) as e:
            result = {"id": item["id"], "status": "error", "detail": str(e)[:180]}
        results.append(result)
    output = {"schema_version": 1, "mode": "notify-only", "results": results}
    Path(args.output).write_text(json.dumps(output, indent=2) + "\n")
    for x in results:
        print(f"{x['id']}: {x['status']}" + (f" ({x.get('latest_ref')})" if x.get("latest_ref") else ""))
    return 1 if any(x["status"] == "error" for x in results) else 0

if __name__ == "__main__":
    sys.exit(main())
