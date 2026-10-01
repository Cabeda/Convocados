#!/usr/bin/env python3
"""Read the live Google Play store listing text for Convocados.

Both Gradle modules publish under the same `applicationId`
(`com.cabeda.Convocados`), so the phone and the Wear OS app share **one** Play
store listing — the full description Play shows on the Wear listing is this
same text. That is how a Wear surface (e.g. the quick-game tile) can ship in
code while the description never mentions it.

`--out` bootstraps `android-app/store-listing/` from what Play actually holds,
so the committed source of truth starts as the real copy rather than invented
copy. GPP's `publishListing` PUTs a whole Listing resource per language, so a
language directory must always carry all three text fields (see
`android-app/PLAY_STORE_PUBLISHING.md`).

Usage:
    python3 scripts/play-listing.py
    python3 scripts/play-listing.py --out android-app/store-listing

Credentials: `android-app/play-service-account.json` (gitignored) or
`PLAY_SERVICE_ACCOUNT_JSON` holding the service account JSON. The service
account needs the "Manage store presence" permission. Only the account's
`client_email` is ever printed — never the private key.
"""

import argparse
import base64
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

PUBLISHER = "https://androidpublisher.googleapis.com/androidpublisher/v3"
SCOPE = "https://www.googleapis.com/auth/androidpublisher"
TOKEN_URL = "https://oauth2.googleapis.com/token"
DEFAULT_PACKAGE = "com.cabeda.Convocados"
FIELDS = ("title", "shortDescription", "fullDescription")
# These are Gradle Play Publisher's filenames, hyphenated (see
# com/github/triplet/gradle/play/internal/ListingDetail). They must match
# android-app/store-listing/ and the names `pnpm check:play-listing` enforces:
# the uploader silently ignores an underscored name, which is how the first
# release shipped a title and no description. `--out` runs the gate over its own
# output, so this tool cannot write a layout the gate would reject.
FIELD_FILES = {
    "title": "title.txt",
    "shortDescription": "short-description.txt",
    "fullDescription": "full-description.txt",
}


def credentials() -> dict:
    local = pathlib.Path("android-app/play-service-account.json")
    if local.is_file():
        return json.loads(local.read_text(encoding="utf-8"))
    raw = os.environ.get("PLAY_SERVICE_ACCOUNT_JSON")
    if not raw:
        sys.exit(
            "No service account found. Put the JSON at "
            "android-app/play-service-account.json or export "
            "PLAY_SERVICE_ACCOUNT_JSON."
        )
    return json.loads(raw)


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def sign_rs256(private_key_pem: str, payload: bytes) -> bytes:
    """RS256 signature, via `cryptography` when present else the openssl CLI."""
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding

        key = serialization.load_pem_private_key(
            private_key_pem.encode("utf-8"), password=None
        )
        return key.sign(payload, padding.PKCS1v15(), hashes.SHA256())
    except ImportError:
        with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False) as pem:
            pem.write(private_key_pem)
            path = pem.name
        try:
            completed = subprocess.run(
                ["openssl", "dgst", "-sha256", "-sign", path],
                input=payload,
                capture_output=True,
                check=True,
            )
            return completed.stdout
        finally:
            os.unlink(path)


def access_token(sa: dict) -> str:
    now = int(time.time())
    claims = {
        "iss": sa["client_email"],
        "scope": SCOPE,
        "aud": TOKEN_URL,
        "iat": now,
        "exp": now + 3600,
    }
    signing_input = ".".join(
        [
            b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode("utf-8")),
            b64(json.dumps(claims).encode("utf-8")),
        ]
    ).encode("ascii")
    assertion = (
        f"{signing_input.decode('ascii')}.{b64(sign_rs256(sa['private_key'], signing_input))}"
    )

    request = urllib.request.Request(
        TOKEN_URL,
        data=urllib.parse.urlencode(
            {
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            }
        ).encode("ascii"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)["access_token"]


def call(url: str, token: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST" if data is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        if error.code in (401, 403):
            sys.exit(
                f"Play rejected the request ({error.code}). The service account "
                "needs access to the package with 'Manage store presence'. "
                f"Response: {detail}"
            )
        sys.exit(f"Play API {error.code} for {url}: {detail}")


def fetch(package: str, token: str) -> dict[str, dict]:
    edit = call(f"{PUBLISHER}/applications/{package}/edits", token, {})
    listings = call(
        f"{PUBLISHER}/applications/{package}/edits/{edit['id']}/listings", token
    )
    return {entry["language"]: entry for entry in listings.get("listings", [])}


def write_out(listings: dict[str, dict], out: pathlib.Path) -> None:
    """Write the dump, and leave it in `out` only once the gate accepts it.

    The dump is staged beside `out` and promoted after `verify_out` passes, so a
    live listing that fails the gate cannot overwrite a directory that holds
    something worth keeping — `--out android-app/store-listing` would otherwise
    destroy the committed source of truth with the very text the gate rejects,
    leaving it recoverable only through git.
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    staging = pathlib.Path(tempfile.mkdtemp(prefix=".play-listing-", dir=out.parent))
    try:
        for language, listing in sorted(listings.items()):
            directory = staging / language
            directory.mkdir(parents=True, exist_ok=True)
            for field in FIELDS:
                value = listing.get(field, "")
                target = directory / FIELD_FILES[field]
                target.write_text(value, encoding="utf-8")
                print(f"wrote {target} ({len(value)} chars)", flush=True)
        verify_out(staging)
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    # Promote field by field, and only the fields this tool wrote. Anything else
    # in the destination is not ours to delete: a dump reads three text fields,
    # so it knows nothing about the files that sit beside them.
    for language in sorted(listings):
        for field in FIELDS:
            source = staging / language / FIELD_FILES[field]
            destination = out / language / FIELD_FILES[field]
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
    shutil.rmtree(staging, ignore_errors=True)


def verify_out(out: pathlib.Path) -> None:
    """Run the repo's own gate over what was just written.

    The gate is the single source of truth for the field names and the Wear
    surface obligations. Running it here means a dump can never quietly produce a
    layout that would not publish — the failure mode that cost a release. So the
    paths are resolved from this file rather than the working directory, and a
    missing gate is fatal: skipping the check from the wrong directory would
    reintroduce the silent gap this tool exists to close.
    """
    root = pathlib.Path(__file__).resolve().parent.parent
    gate = root / "scripts/check-play-listing.mjs"
    wear = root / "android-app/wear"
    if not gate.is_file():
        sys.exit(f"Cannot verify {out}: the listing gate is missing at {gate}.")
    if not wear.is_dir():
        sys.exit(f"Cannot verify {out}: the Wear module is missing at {wear}.")
    completed = subprocess.run(
        ["node", str(gate), "--listing", str(out), "--wear", str(wear)],
        check=False,
    )
    if completed.returncode != 0:
        sys.exit(
            f"The dump staged for {out} does not satisfy the listing gate. Fix "
            f"the names or the copy before using it; nothing was written to {out}."
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", default=DEFAULT_PACKAGE)
    parser.add_argument(
        "--out",
        type=pathlib.Path,
        help="Write each language's listing text under this directory.",
    )
    args = parser.parse_args()

    sa = credentials()
    print(f"service account: {sa.get('client_email', '<unknown>')}")
    listings = fetch(args.package, access_token(sa))
    if not listings:
        sys.exit("Play returned no listings for this package.")

    for language, listing in sorted(listings.items()):
        print(f"\n=== {language} ===")
        for field in FIELDS:
            value = listing.get(field, "")
            print(f"--- {field} ({len(value)} chars) ---")
            print(value)

    if args.out:
        write_out(listings, args.out)


if __name__ == "__main__":
    main()
