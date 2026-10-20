import sqlite3
import time
from pathlib import Path
from typing import Optional, Tuple, Dict, Any

TOTAL_LIMIT_BYTES = 10 * 1024 * 1024 * 1024  # 10 GiB (10 * 1024^3 bytes)

def format_gib(bytes_count: int, ceil_small: bool = False) -> str:
    """Format bytes into GiB with 2 decimal places."""
    if bytes_count <= 0:
        return "0.00 GiB"
    gib = bytes_count / (1024 ** 3)
    if ceil_small and 0 < gib < 0.01:
        return "0.01 GiB"
    return f"{gib:.2f} GiB"

class ReservationStore:
    def __init__(self, db_path: Path | str):
        self.db_path = str(db_path)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10.0, isolation_level=None)
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        return conn

    def _init_db(self) -> None:
        with self._get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS upload_reservations (
                    upload_id TEXT PRIMARY KEY,
                    object_key TEXT NOT NULL,
                    file_size INTEGER NOT NULL,
                    status TEXT NOT NULL, -- 'reserved', 'completed', 'aborted'
                    created_at REAL NOT NULL,
                    expires_at REAL NOT NULL
                );
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_reservations_status_expires
                ON upload_reservations (status, expires_at);
            """)

    def clean_expired(self, now: Optional[float] = None) -> int:
        now = now or time.time()
        with self._get_connection() as conn:
            cur = conn.execute(
                "DELETE FROM upload_reservations WHERE status != 'reserved' OR expires_at < ?;",
                (now,)
            )
            return cur.rowcount

    def get_reserved_bytes(self, now: Optional[float] = None) -> int:
        now = now or time.time()
        with self._get_connection() as conn:
            cur = conn.execute(
                "SELECT COALESCE(SUM(file_size), 0) FROM upload_reservations WHERE status = 'reserved' AND expires_at >= ?;",
                (now,)
            )
            row = cur.fetchone()
            return int(row[0]) if row else 0

    def get_active_reservation_count(self, now: Optional[float] = None) -> int:
        now = now or time.time()
        with self._get_connection() as conn:
            cur = conn.execute(
                "SELECT COUNT(*) FROM upload_reservations WHERE status = 'reserved' AND expires_at >= ?;",
                (now,)
            )
            row = cur.fetchone()
            return int(row[0]) if row else 0

    def reserve(
        self,
        upload_id: str,
        object_key: str,
        file_size: int,
        existing_stored_bytes: int,
        ttl_seconds: int = 86400,
        now: Optional[float] = None
    ) -> Tuple[bool, Optional[str], Dict[str, Any]]:
        now = now or time.time()
        expires_at = now + ttl_seconds

        with self._get_connection() as conn:
            conn.execute("BEGIN IMMEDIATE;")
            try:
                # 1. Purge expired or completed/aborted entries
                conn.execute(
                    "DELETE FROM upload_reservations WHERE status != 'reserved' OR expires_at < ?;",
                    (now,)
                )

                # 2. Query outstanding reserved bytes
                cur = conn.execute(
                    "SELECT COALESCE(SUM(file_size), 0) FROM upload_reservations WHERE status = 'reserved' AND expires_at >= ?;",
                    (now,)
                )
                active_reserved = int(cur.fetchone()[0])

                # 3. Strict Capacity Validation: existing + reserved + new must be strictly less than 10 GiB
                projected_total = existing_stored_bytes + active_reserved + file_size
                available = max(0, TOTAL_LIMIT_BYTES - (existing_stored_bytes + active_reserved))

                if projected_total >= TOTAL_LIMIT_BYTES:
                    conn.execute("ROLLBACK;")
                    # Calculate minimum amount to clear so that:
                    # (existing_stored_bytes - min_to_clear) + active_reserved + file_size < TOTAL_LIMIT_BYTES
                    # i.e., min_to_clear >= projected_total - TOTAL_LIMIT_BYTES + 1
                    min_to_clear = projected_total - TOTAL_LIMIT_BYTES + 1

                    error_msg = (
                        f"Not enough storage for this video. "
                        f"Available storage: {format_gib(available)}. "
                        f"This video requires {format_gib(file_size)}. "
                        f"Clear at least {format_gib(min_to_clear, ceil_small=True)} of storage to upload it."
                    )
                    return False, error_msg, {
                        "availableStorage": available,
                        "requiredStorage": file_size,
                        "clearRequired": min_to_clear,
                        "limitBytes": TOTAL_LIMIT_BYTES,
                        "storedBytes": existing_stored_bytes,
                        "reservedBytes": active_reserved,
                    }

                # 4. Insert active reservation
                conn.execute(
                    """
                    INSERT OR REPLACE INTO upload_reservations
                    (upload_id, object_key, file_size, status, created_at, expires_at)
                    VALUES (?, ?, ?, 'reserved', ?, ?);
                    """,
                    (upload_id, object_key, file_size, now, expires_at)
                )
                conn.execute("COMMIT;")
                return True, None, {
                    "availableStorage": max(0, available - file_size),
                    "requiredStorage": file_size,
                    "clearRequired": 0,
                    "limitBytes": TOTAL_LIMIT_BYTES,
                    "storedBytes": existing_stored_bytes,
                    "reservedBytes": active_reserved + file_size,
                }
            except Exception:
                conn.execute("ROLLBACK;")
                raise

    def rebind_upload_id(self, old_upload_id: str, new_upload_id: str) -> None:
        with self._get_connection() as conn:
            conn.execute("DELETE FROM upload_reservations WHERE upload_id = ?;", (new_upload_id,))
            conn.execute(
                "UPDATE upload_reservations SET upload_id = ? WHERE upload_id = ?;",
                (new_upload_id, old_upload_id)
            )

    def release(self, upload_id: str) -> None:
        with self._get_connection() as conn:
            conn.execute("DELETE FROM upload_reservations WHERE upload_id = ?;", (upload_id,))

    def complete(self, upload_id: str) -> None:
        with self._get_connection() as conn:
            conn.execute("DELETE FROM upload_reservations WHERE upload_id = ?;", (upload_id,))

    def clear_all(self) -> None:
        with self._get_connection() as conn:
            conn.execute("DELETE FROM upload_reservations;")
