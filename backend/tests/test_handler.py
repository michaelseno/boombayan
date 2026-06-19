import json


def test_handler_invokes_health_route():
    from app.handler import handler

    event = {
        "version": "2.0",
        "routeKey": "GET /health",
        "rawPath": "/health",
        "rawQueryString": "",
        "headers": {},
        "requestContext": {
            "http": {"method": "GET", "path": "/health", "sourceIp": "127.0.0.1"},
        },
        "isBase64Encoded": False,
    }
    response = handler(event, None)
    assert response["statusCode"] == 200
    assert json.loads(response["body"]) == {"status": "ok"}
