import os

from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

_key = os.getenv("ENCRYPTION_KEY")
_fernet = Fernet(_key.encode()) if _key else None


def encrypt(value: str) -> str:
    if not _fernet:
        raise RuntimeError("ENCRYPTION_KEY is not set in the backend .env")

    return _fernet.encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    if not _fernet:
        raise RuntimeError("ENCRYPTION_KEY is not set in the backend .env")

    return _fernet.decrypt(value.encode()).decode()
