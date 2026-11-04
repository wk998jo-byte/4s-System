from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


def error_body(
    code: str,
    message: str,
    *,
    details: list[dict] | None = None,
    http_status: int = 400,
) -> JSONResponse:
    return JSONResponse(
        status_code=http_status,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details or [],
            }
        },
    )


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def validation_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        details = []
        for item in exc.errors():
            loc = [part for part in item.get("loc", []) if part != "body"]
            field = ".".join(str(part) for part in loc) or "body"
            details.append(
                {
                    "field": field,
                    "code": item.get("type", "value_error"),
                    "message": item.get("msg", "Invalid value"),
                }
            )
        return error_body(
            "VALIDATION_ERROR",
            "One or more fields failed validation.",
            details=details,
            http_status=400,
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(
        _request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        if exc.status_code == 401:
            code = "UNAUTHENTICATED"
        elif exc.status_code == 403:
            code = "ACCESS_DENIED"
        elif exc.status_code == 404:
            code = "NOT_FOUND"
        else:
            code = "HTTP_ERROR"
        message = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return error_body(code, message, http_status=exc.status_code)
