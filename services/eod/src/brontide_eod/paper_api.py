"""Local-only paper API. Preparation, approval and economic actions are separate."""
from typing import Literal
from urllib.parse import urlsplit
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from .ibkr_tws import PaperSafetyError
from .paper_service import PaperService

service = PaperService()


def local_request(request: Request):
    if request.client and request.client.host not in {"127.0.0.1", "::1", "testclient"}:
        raise HTTPException(403, "Paper execution is loopback-only.")
    if request.method != "GET" and request.headers.get("X-Brontide-Local") != "1":
        raise HTTPException(403, "Local paper request required.")
    origin = request.headers.get("origin")
    if origin and urlsplit(origin).netloc != request.url.netloc:
        raise HTTPException(403, "Cross-origin paper requests are not permitted.")


router = APIRouter(prefix="/v1/ibkr/paper", dependencies=[Depends(local_request)])


def execution_service(): return service


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
    revision: int = Field(ge=1)
    commandId: str = Field(min_length=1, max_length=128)
    action: Literal["save-amendment", "apply-amendment", "cancel-entry", "cancel-exits", "cleanup", "resume"]
    payload: dict | None = None


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


@router.post("/submit")
def submit(body: SubmitRequest, s: PaperService = Depends(execution_service)):
    return call(s.submit, body.batchId, body.ticketIndex, body.commandId)


@router.post("/campaigns/{campaign_id}/actions")
def action(campaign_id: str, body: CampaignRequest, s: PaperService = Depends(execution_service)):
    return call(s.action, campaign_id, body.revision, body.commandId, body.action, body.payload)
