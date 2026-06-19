from fastapi import FastAPI

from .routers import health

app = FastAPI(title="Boombayan LMS API")
app.include_router(health.router)
