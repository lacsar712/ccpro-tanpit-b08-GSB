from django.db import DatabaseError, connection, transaction
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError

from pits.auth import BearerAuth, make_token
from pits.models import Pit, User, Yard
from pits.rules import (
    RuleError,
    assert_can_set_status,
    batch_for_prefetched,
    summarize,
)

api = NinjaAPI(title="TanPit", urls_namespace="tanpit")
auth = BearerAuth()


class LoginIn(Schema):
    username: str
    password: str


class SampleIn(Schema):
    ph: float


class StatusIn(Schema):
    status: str


def pit_json(pit: Pit) -> dict:
    # 贴片与均值取自同一批未作废库记录，一次取数同时算出，两侧差必然对得上。
    stats = summarize(batch_for_prefetched(pit))
    return {
        "id": pit.id,
        "code": pit.code,
        "status": pit.status,
        "row": pit.row,
        "col": pit.col,
        "latestPh": stats["latestPh"],
        "avgPh": stats["avgPh"],
        "sampleCount": stats["sampleCount"],
        "values": stats["values"],
    }


def yard_with_pits() -> tuple[Yard, list[Pit]]:
    yard = Yard.objects.prefetch_related("pits__samples").first()
    if yard is None:
        raise HttpError(404, "尚无鞣场")
    pits = sorted(yard.pits.all(), key=lambda p: (p.row, p.col))
    return yard, pits


@api.post("/auth/login")
def login(request, payload: LoginIn):
    user = User.objects.filter(username=payload.username).first()
    if user is None or not user.check_password(payload.password):
        raise HttpError(401, "用户名或密码错误")
    return {"access_token": make_token(user.username), "user": {"username": user.username, "role": user.role}}


@api.get("/auth/me", auth=auth)
def me(request):
    user = request.auth
    return {"username": user.username, "role": user.role}


@api.get("/health")
def health(request):
    return {"status": "ok", "service": "TanPit"}


@api.get("/board", auth=auth)
def board(request):
    # 场地图贴片与均值专页共用这一份响应：每坑的 latestPh/avgPh/values
    # 都在同一次 prefetch 取数里由同一批未作废记录算出，差必然对得上。
    yard, pits = yard_with_pits()
    return {"yard": yard.name, "village": yard.village, "pits": [pit_json(p) for p in pits]}


@api.post("/pits/{pit_id}/samples", auth=auth)
def add_sample(request, pit_id: int, payload: SampleIn):
    # 两名工抢着给同一坑各登一条：对坑行加 nowait 行锁，
    # 拿不到锁的并发登记直接 409，只许一条入库。
    try:
        with transaction.atomic():
            pit_qs = Pit.objects
            if getattr(connection.features, "has_select_for_update", False):
                # Postgres：对坑行 NOWAIT 加锁，抢不到即抛错（见 except）。
                pit_qs = pit_qs.select_for_update(nowait=True)
            pit = pit_qs.filter(id=pit_id).first()
            if pit is None:
                raise HttpError(404, "坑不存在")
            pit.samples.create(ph=payload.ph, operator=request.auth.username)
    except DatabaseError as exc:
        raise HttpError(409, "该坑正有另一条登记在写入，请刷新后重试") from exc
    pit = Pit.objects.prefetch_related("samples").get(id=pit_id)
    return pit_json(pit)


@api.post("/pits/{pit_id}/status", auth=auth)
def set_status(request, pit_id: int, payload: StatusIn):
    # 改坑态不看贴片规矩：状态变更与酸碱登记互不干涉，也不做坑位互斥。
    pit = Pit.objects.prefetch_related("samples").filter(id=pit_id).first()
    if pit is None:
        raise HttpError(404, "坑不存在")
    try:
        assert_can_set_status(pit, payload.status)
    except RuleError as exc:
        raise HttpError(400, str(exc))
    pit.status = payload.status
    pit.save(update_fields=["status"])
    return pit_json(pit)
