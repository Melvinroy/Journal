"""Local-only paper API. Preparation, approval and economic actions are separate."""
from typing import Literal
from urllib.parse import urlsplit
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from .ibkr_tws import PaperSafetyError
from .paper_service import PaperService
from .paper_auth import verified_user, require_owner, owner_path

service = PaperService()


def local_request(request: Request):
    if request.client and request.client.host not in {"127.0.0.1", "::1", "testclient"}:
        raise HTTPException(403, "Paper execution is loopback-only.")
    if request.method != "GET" and request.headers.get("X-Brontide-Local") != "1":
        raise HTTPException(403, "Local paper request required.")
    origin = request.headers.get("origin")
    if origin and urlsplit(origin).netloc != request.url.netloc:
        raise HTTPException(403, "Cross-origin paper requests are not permitted.")


def current_operator(user=Depends(verified_user)):
    owner = require_owner(user)
    service.authenticated(owner["id"])
    return owner


router = APIRouter(prefix="/v1/ibkr/paper", dependencies=[Depends(local_request)])


def execution_service(user=Depends(current_operator)): return service


@router.get("/identity")
def identity(user=Depends(verified_user)):
    try:
        require_owner(user)
        return {"userId": user["id"], "email": user["email"], "linked": True}
    except HTTPException as exc:
        return {"userId": user["id"], "email": user["email"], "linked": False, "linkState": "mismatch" if owner_path().exists() else "unlinked", "message": exc.detail}


def call(operation, *args):
    try: return operation(*args)
    except PaperSafetyError as exc: raise HTTPException(409, str(exc)) from None
    except (OSError, sqlite3.Error): raise HTTPException(503, "Private paper persistence or transport is unavailable; no retry is authorized.") from None
    except (ValueError, TypeError, KeyError): raise HTTPException(422, "Invalid or incomplete paper request.") from None


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BatchRequest(StrictBody):
    tickets: list[dict] = Field(min_length=1, max_length=2)


class SubmitRequest(StrictBody):
    batchId: str = Field(min_length=1, max_length=128)
    ticketIndex: int = Field(ge=0, le=1)
    commandId: str = Field(min_length=1, max_length=128)


class CampaignRequest(StrictBody):
    connectionId: str | None = None
    revision: int = Field(ge=1)
    commandId: str = Field(min_length=1, max_length=128)
    action: Literal["save-amendment", "apply-amendment", "cancel-entry", "cancel-exits", "cleanup", "resume"]
    payload: dict | None = None


class ApprovalRequest(StrictBody):
    digest: str = Field(min_length=64, max_length=64)
    commandId: str = Field(min_length=1, max_length=128)


@router.post("/batches/{batch_id}/approve")
def approve(batch_id: str, body: ApprovalRequest, s: PaperService = Depends(execution_service)):
    return call(s.approve, batch_id, body.digest, body.commandId)


@router.get("/status")
def status(s: PaperService = Depends(execution_service)): return call(s.status)


@router.post("/connect")
def connect(s: PaperService = Depends(execution_service)): return call(s.connect)


@router.post("/disconnect")
def disconnect(s: PaperService = Depends(execution_service)): return call(s.disconnect)


@router.post("/reconcile")
def reconcile(s: PaperService = Depends(execution_service)): return call(s.reconcile)


@router.get("/quote/{symbol}")
def quote(symbol: str, s: PaperService = Depends(execution_service)): return call(s.quote, symbol)


@router.post("/batches")
def batch(body: BatchRequest, s: PaperService = Depends(execution_service)): return call(s.prepare_batch, body.tickets)


@router.post("/batches/{batch_id}/arm")
def arm(batch_id: str, s: PaperService = Depends(execution_service)): return call(s.arm, batch_id)


@router.post("/disarm")
def disarm(s: PaperService = Depends(execution_service)): return call(s.disarm)


@router.post("/signout")
def signout(s: PaperService = Depends(execution_service)):
    from .paper_service import utcnow
    result = call(s.disarm)
    s.operator_deadline = utcnow()
    return result


@router.post("/submit")
def submit(body: SubmitRequest, s: PaperService = Depends(execution_service)):
    return call(s.submit, body.batchId, body.ticketIndex, body.commandId)


@router.post("/campaigns/{campaign_id}/actions")
def action(campaign_id: str, body: CampaignRequest, s: PaperService = Depends(execution_service)):
    if body.action != "save-amendment" and (not body.connectionId or body.connectionId != s.connection_id):
        raise HTTPException(409, "Connection changed. Review the current position before applying an action.")
    operation = s.action if body.action == "save-amendment" else s.review_action
    return call(operation, campaign_id, body.revision, body.commandId, body.action, body.payload)
