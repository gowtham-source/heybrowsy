from fastapi.testclient import TestClient
from heybrowsy.main import app


client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["service"] == "heybrowsy"


def test_rejects_invalid_task():
    response = client.post("/v1/tasks", json={"goal": "x"})
    assert response.status_code == 422

