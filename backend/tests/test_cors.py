from app.main import _parse_allowed_origins


def test_cors_allows_configured_origin(client):
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_rejects_unconfigured_origin(client):
    response = client.get("/health", headers={"Origin": "http://evil.example.com"})
    assert "access-control-allow-origin" not in response.headers


def test_parse_allowed_origins_strips_whitespace_after_comma():
    # CORS_ALLOWED_ORIGINS is documented as comma-separated, and "a, b" is
    # the natural way most people write a multi-origin list. Without
    # stripping, the second entry would be " https://app.example.com" with a
    # leading space, which silently never matches a real Origin header.
    value = "http://localhost:5173, https://app.example.com"
    assert _parse_allowed_origins(value) == [
        "http://localhost:5173",
        "https://app.example.com",
    ]


def test_cors_allows_comma_space_separated_origin(monkeypatch):
    # End-to-end regression check: configure CORS_ALLOWED_ORIGINS the
    # "comma-then-space" way and confirm the second origin still matches.
    # CORSMiddleware is wired up at app.add_middleware() call time in
    # main.py, which already ran at import, so we re-import the module
    # fresh after monkeypatching settings to pick up the new value.
    import importlib

    from app.config import settings

    monkeypatch.setattr(
        settings,
        "cors_allowed_origins",
        "http://localhost:5173, https://app.example.com",
    )

    import app.main as main_module

    importlib.reload(main_module)
    try:
        from fastapi.testclient import TestClient

        with TestClient(main_module.app) as fresh_client:
            response = fresh_client.get(
                "/health", headers={"Origin": "https://app.example.com"}
            )
            assert (
                response.headers["access-control-allow-origin"]
                == "https://app.example.com"
            )
    finally:
        # Restore the module-level app/middleware built from real settings
        # so later tests in the suite use the original `client` fixture's
        # expectations (it imports `app.main.app` at collection time).
        importlib.reload(main_module)
