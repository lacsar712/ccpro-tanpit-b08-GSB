"""鞣坑放液门槛：最近一次浸液酸碱度须在 3.5～5.0。

贴片（最近酸碱）与均值页都只认未作废记录（voided_at 为空），
且必须由同一批取数同时算出，避免两侧各查一次出现对不上的差。
"""

from pits.models import LiquorSample, Pit

MIN_PH = 3.5
MAX_PH = 5.0


class RuleError(ValueError):
    pass


def active_samples(pit: Pit) -> list[LiquorSample]:
    """该坑全部未作废酸碱，按时刻从早到晚（同时刻以录入先后 id 兜底）。"""
    return list(pit.samples.filter(voided_at__isnull=True).order_by("taken_at", "id"))


def batch_for_prefetched(pit: Pit) -> list[LiquorSample]:
    """对已 prefetch samples 的坑在内存里筛未作废并排序，不再查库。"""
    samples = [s for s in pit.samples.all() if s.voided_at is None]
    samples.sort(key=lambda s: (s.taken_at, s.id))
    return samples


def summarize(samples: list[LiquorSample]) -> dict:
    """同一批未作废记录一次算出贴片、均值、条数与全部取值。"""
    values = [s.ph for s in samples]
    count = len(values)
    return {
        "latestPh": values[-1] if count else None,
        "avgPh": (sum(values) / count) if count else None,
        "sampleCount": count,
        "values": values,
    }


def latest_ph(pit: Pit) -> float | None:
    samples = active_samples(pit)
    return None if not samples else samples[-1].ph


def assert_can_set_status(pit: Pit, new_status: str) -> None:
    allowed = {Pit.STATUS_FILL, Pit.STATUS_TANNING, Pit.STATUS_DRAINED}
    if new_status not in allowed:
        raise RuleError(f"无效状态：{new_status}")
    if new_status != Pit.STATUS_DRAINED:
        return
    ph = latest_ph(pit)
    if ph is None:
        raise RuleError("该坑尚无浸液酸碱记录，不能放液")
    if ph < MIN_PH or ph > MAX_PH:
        raise RuleError(f"最近酸碱度 {ph} 不在 {MIN_PH}～{MAX_PH}，不能放液")
