#!/usr/bin/env python3
"""AqroVision local backend & static server.

Stores user accounts, authentication credentials, saved fields, and agronomic
notes as persistent JSON files under ./backend/ using only Python's standard
library so the app runs out-of-the-box without external package installs.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sys
import threading
import time
import urllib.parse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
USERS_DIR = BACKEND_DIR / "users"
ACCOUNTS_FILE = BACKEND_DIR / "accounts.json"
CONFIG_FILE = BACKEND_DIR / "config.json"

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
SAFE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{3,64}$")
PBKDF2_ITERATIONS = 200_000
TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

DATA_LOCK = threading.RLock()


def ensure_backend_storage() -> dict[str, Any]:
    """Initialize backend directory, config.json, and accounts.json safely."""
    with DATA_LOCK:
        BACKEND_DIR.mkdir(parents=True, exist_ok=True)
        USERS_DIR.mkdir(parents=True, exist_ok=True)

        if CONFIG_FILE.exists():
            try:
                cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            except Exception:
                cfg = {}
        else:
            cfg = {}

        changed = False
        if not isinstance(cfg.get("secretKey"), str) or len(cfg["secretKey"]) < 32:
            cfg["secretKey"] = secrets.token_hex(32)
            changed = True

        if changed or not CONFIG_FILE.exists():
            atomic_write_json(CONFIG_FILE, cfg)

        if not ACCOUNTS_FILE.exists():
            atomic_write_json(ACCOUNTS_FILE, {"accounts": []})

        return cfg


def atomic_write_json(path: Path, payload: Any) -> None:
    """Write JSON atomically via temp file replacement."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.{secrets.token_hex(6)}.tmp")
    tmp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(tmp_path, path)


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def get_config() -> dict[str, Any]:
    return ensure_backend_storage()


def hash_password(password: str) -> dict[str, Any]:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        PBKDF2_ITERATIONS,
    ).hex()
    return {
        "alg": "pbkdf2_sha256",
        "iterations": PBKDF2_ITERATIONS,
        "salt": salt,
        "hash": digest,
    }


def verify_password(password: str, stored: dict[str, Any] | None) -> bool:
    if not stored or not isinstance(stored, dict):
        return False
    salt = stored.get("salt")
    expected = stored.get("hash")
    iterations = int(stored.get("iterations") or PBKDF2_ITERATIONS)
    if not isinstance(salt, str) or not isinstance(expected, str):
        return False
    try:
        actual = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt),
            iterations,
        ).hex()
    except Exception:
        return False
    return hmac.compare_digest(actual, expected)


def _b64u_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64u_decode(val: str) -> bytes:
    pad = "=" * (-len(val) % 4)
    return base64.urlsafe_b64decode((val + pad).encode("ascii"))


def create_token(user_id: str, secret_key: str) -> str:
    payload = {
        "uid": user_id,
        "iat": int(time.time()),
        "exp": int(time.time()) + TOKEN_TTL_SECONDS,
    }
    encoded = _b64u_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(secret_key.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded}.{_b64u_encode(sig)}"


def verify_token(token: str, secret_key: str) -> str | None:
    if not token or "." not in token:
        return None
    try:
        encoded, sig_part = token.split(".", 1)
        expected_sig = _b64u_encode(
            hmac.new(secret_key.encode("utf-8"), encoded.encode("ascii"), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(sig_part, expected_sig):
            return None
        payload = json.loads(_b64u_decode(encoded).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        uid = payload.get("uid")
        if isinstance(uid, str) and SAFE_ID_RE.match(uid):
            return uid
    except Exception:
        return None
    return None


def user_file_path(user_id: str) -> Path:
    if not SAFE_ID_RE.match(user_id):
        raise ValueError("Invalid user ID")
    resolved = (USERS_DIR / f"{user_id}.json").resolve()
    if USERS_DIR.resolve() not in resolved.parents:
        raise ValueError("Invalid user path")
    return resolved


def public_user_view(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": record["id"],
        "name": record.get("name", "Farmer"),
        "farm": record.get("farm", ""),
        "email": record["email"],
        "createdAt": record.get("createdAt", ""),
        "updatedAt": record.get("updatedAt", ""),
    }


def load_accounts_index() -> list[dict[str, Any]]:
    data = read_json(ACCOUNTS_FILE, {"accounts": []})
    accounts = data.get("accounts")
    return accounts if isinstance(accounts, list) else []


def save_accounts_index(accounts: list[dict[str, Any]]) -> None:
    atomic_write_json(ACCOUNTS_FILE, {"accounts": accounts})


def find_account_by_email(email: str) -> dict[str, Any] | None:
    target = email.strip().lower()
    for acc in load_accounts_index():
        if str(acc.get("email", "")).strip().lower() == target:
            path = user_file_path(acc["id"])
            record = read_json(path, None)
            if isinstance(record, dict):
                return record
    return None


def upsert_user_record(record: dict[str, Any]) -> None:
    with DATA_LOCK:
        path = user_file_path(record["id"])
        atomic_write_json(path, record)

        accounts = load_accounts_index()
        summary = {
            "id": record["id"],
            "email": record["email"],
            "name": record.get("name", ""),
            "farm": record.get("farm", ""),
            "file": f"users/{record['id']}.json",
            "createdAt": record.get("createdAt", ""),
            "updatedAt": record.get("updatedAt", ""),
        }
        replaced = False
        for idx, acc in enumerate(accounts):
            if acc.get("id") == record["id"]:
                accounts[idx] = summary
                replaced = True
                break
        if not replaced:
            accounts.append(summary)
        save_accounts_index(accounts)


class AqroHandler(SimpleHTTPRequestHandler):
    server_version = "AqroVisionBackend/1.0"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        # Keep console output concise and readable
        sys.stderr.write("[AqroVision] " + (format % args) + "\n")

    def _send_cors_headers(self) -> None:
        origin = self.headers.get("Origin") or "*"
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Credentials", "true")

    def _send_json(self, status: int, payload: Any) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _read_json_body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            return {}
        if length <= 0 or length > 2_000_000:
            return {}
        raw = self.rfile.read(length)
        try:
            parsed = json.loads(raw.decode("utf-8"))
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}

    def _get_auth_record(self) -> dict[str, Any] | None:
        cfg = get_config()
        auth_header = self.headers.get("Authorization", "")
        token = ""
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
        if not token:
            return None
        uid = verify_token(token, cfg["secretKey"])
        if not uid:
            return None
        with DATA_LOCK:
            try:
                record = read_json(user_file_path(uid), None)
                return record if isinstance(record, dict) else None
            except ValueError:
                return None

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            with DATA_LOCK:
                count = len(load_accounts_index())
            return self._send_json(200, {"ok": True, "backend": "aqrovision", "accountsCount": count})

        if path == "/api/auth/config":
            return self._send_json(
                200,
                {
                    "ok": True,
                    "backend": "aqrovision",
                },
            )

        if path == "/api/auth/me":
            record = self._get_auth_record()
            if not record:
                return self._send_json(401, {"ok": False, "code": "UNAUTHORIZED", "error": "Session expired or invalid."})
            return self._send_json(
                200,
                {
                    "ok": True,
                    "user": public_user_view(record),
                    "fields": record.get("fields", []),
                    "notes": record.get("notes", []),
                },
            )

        if path == "/api/user/data":
            record = self._get_auth_record()
            if not record:
                return self._send_json(401, {"ok": False, "code": "UNAUTHORIZED", "error": "Authentication required."})
            return self._send_json(
                200,
                {
                    "ok": True,
                    "fields": record.get("fields", []),
                    "notes": record.get("notes", []),
                },
            )

        if path.startswith("/api/"):
            return self._send_json(404, {"ok": False, "error": "Endpoint not found"})

        # Block raw browser access to private backend user/config files
        clean_path = urllib.parse.unquote(path).lstrip("/")
        if clean_path.startswith("backend"):
            return self._send_json(403, {"ok": False, "error": "Forbidden"})

        if path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        body = self._read_json_body()
        cfg = get_config()

        if path == "/api/auth/signup":
            name = str(body.get("name") or "").strip()
            farm = str(body.get("farm") or "").strip()
            email = str(body.get("email") or "").strip().lower()
            password = str(body.get("password") or "")

            if not name or not email or not password:
                return self._send_json(400, {"ok": False, "code": "FILL_ALL", "error": "Please fill in all required fields."})
            if not EMAIL_RE.match(email):
                return self._send_json(400, {"ok": False, "code": "EMAIL_INVALID", "error": "Please enter a valid email address."})
            if len(password) < 6:
                return self._send_json(400, {"ok": False, "code": "PW_SHORT", "error": "Password must be at least 6 characters long."})

            with DATA_LOCK:
                if find_account_by_email(email):
                    return self._send_json(409, {"ok": False, "code": "EMAIL_TAKEN", "error": "An account with this email already exists."})

                now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                uid = f"u_{int(time.time() * 1000)}_{secrets.token_hex(3)}"
                record = {
                    "id": uid,
                    "name": name,
                    "farm": farm,
                    "email": email,
                    "passwordAuth": hash_password(password),
                    "fields": [],
                    "notes": [],
                    "createdAt": now_iso,
                    "updatedAt": now_iso,
                }
                upsert_user_record(record)

            token = create_token(uid, cfg["secretKey"])
            return self._send_json(
                201,
                {
                    "ok": True,
                    "token": token,
                    "user": public_user_view(record),
                    "fields": [],
                    "notes": [],
                },
            )

        if path == "/api/auth/login":
            email = str(body.get("email") or "").strip().lower()
            password = str(body.get("password") or "")
            if not email or not password:
                return self._send_json(400, {"ok": False, "code": "FILL_ALL", "error": "Please fill in email and password."})

            with DATA_LOCK:
                record = find_account_by_email(email)

            if not record or not verify_password(password, record.get("passwordAuth")):
                return self._send_json(401, {"ok": False, "code": "INVALID_CREDS", "error": "Invalid email or password."})

            token = create_token(record["id"], cfg["secretKey"])
            return self._send_json(
                200,
                {
                    "ok": True,
                    "token": token,
                    "user": public_user_view(record),
                    "fields": record.get("fields", []),
                    "notes": record.get("notes", []),
                },
            )

        if path == "/api/auth/change-password":
            record = self._get_auth_record()
            if not record:
                return self._send_json(401, {"ok": False, "code": "UNAUTHORIZED", "error": "Authentication required."})

            old_password = str(body.get("oldPassword") or "")
            new_password = str(body.get("newPassword") or "")
            if not old_password or not new_password:
                return self._send_json(400, {"ok": False, "code": "FILL_ALL", "error": "Please fill in current and new passwords."})
            if len(new_password) < 6:
                return self._send_json(400, {"ok": False, "code": "PW_SHORT", "error": "Password must be at least 6 characters long."})

            now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            with DATA_LOCK:
                fresh = read_json(user_file_path(record["id"]), record)
                if not verify_password(old_password, fresh.get("passwordAuth")):
                    return self._send_json(401, {"ok": False, "code": "WRONG_OLD_PASSWORD", "error": "Current password is incorrect."})
                fresh["passwordAuth"] = hash_password(new_password)
                fresh["updatedAt"] = now_iso
                upsert_user_record(fresh)
            return self._send_json(200, {"ok": True, "user": public_user_view(fresh)})

        if path == "/api/user/profile":
            record = self._get_auth_record()
            if not record:
                return self._send_json(401, {"ok": False, "code": "UNAUTHORIZED", "error": "Authentication required."})
            return self._update_profile(record, body)

        if path == "/api/auth/logout":
            return self._send_json(200, {"ok": True})

        return self._send_json(404, {"ok": False, "error": "Endpoint not found"})

    def _update_profile(self, record: dict[str, Any], body: dict[str, Any]) -> None:
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with DATA_LOCK:
            fresh = read_json(user_file_path(record["id"]), record)
            if "farm" in body:
                fresh["farm"] = str(body.get("farm") or "").strip()[:120]
            if "name" in body:
                new_name = str(body.get("name") or "").strip()[:120]
                if not new_name:
                    return self._send_json(400, {"ok": False, "code": "FILL_ALL", "error": "Name cannot be empty."})
                fresh["name"] = new_name
            fresh["updatedAt"] = now_iso
            upsert_user_record(fresh)
        return self._send_json(200, {"ok": True, "user": public_user_view(fresh)})

    def do_PUT(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        record = self._get_auth_record()
        if not record:
            return self._send_json(401, {"ok": False, "code": "UNAUTHORIZED", "error": "Authentication required."})

        body = self._read_json_body()
        now_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

        if path == "/api/user/profile":
            return self._update_profile(record, body)

        if path == "/api/user/fields":
            fields = body.get("fields")
            if not isinstance(fields, list):
                return self._send_json(400, {"ok": False, "error": "fields must be an array"})
            with DATA_LOCK:
                fresh = read_json(user_file_path(record["id"]), record)
                fresh["fields"] = fields
                fresh["updatedAt"] = now_iso
                upsert_user_record(fresh)
            return self._send_json(200, {"ok": True, "fields": fields})

        if path == "/api/user/notes":
            notes = body.get("notes")
            if not isinstance(notes, list):
                return self._send_json(400, {"ok": False, "error": "notes must be an array"})
            with DATA_LOCK:
                fresh = read_json(user_file_path(record["id"]), record)
                fresh["notes"] = notes
                fresh["updatedAt"] = now_iso
                upsert_user_record(fresh)
            return self._send_json(200, {"ok": True, "notes": notes})

        return self._send_json(404, {"ok": False, "error": "Endpoint not found"})


def main() -> None:
    ensure_backend_storage()
    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    httpd = ThreadingHTTPServer((host, port), AqroHandler)
    print(f"AqroVision backend running at http://{host}:{port}")
    print(f"Accounts & user files stored in: {BACKEND_DIR}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down AqroVision backend...")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
