import uvicorn
from heybrowsy.config import get_settings


if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run("heybrowsy.main:app", host=settings.host, port=settings.port, reload=True)

