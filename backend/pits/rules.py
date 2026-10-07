"""鞣坑业务规则。

- 放液门槛：最近一次未作废浸液酸碱度须在 3.5～5.0。
- 贴片与均值同源：坑位贴片、酸碱均值专页都看同一批未作废记录。
- 抢登去重：同一坑短时间内的重复登记只许一条入库。
"""

from datetime import timedelta

from django.utils import timezone

from pits.models import Pit

MIN_PH = 3.5
MAX_PH = 5.0

# 不同人抢着给同一坑登记：2 秒内只许一条入库
RACE_WINDOW = timedelta(seconds=2)
# 同一人重复提交（双击/重试）：1 秒内只许一条入库
RETRY_WINDOW = timedelta(seconds=1)


class RuleError(ValueError):
    pass


def valid_samples(pit: Pit) -> list:
    """该坑全部未作废的浸液酸碱记录；贴片与均值共用这一批。"""
    return [s for s in pit.samples.all() if not s.voided]


def latest_ph(pit: Pit) -> float | None:
    """贴片数字：该坑时刻最晚那条未作废记录的酸碱度。"""
    samples = valid_samples(pit)
    if not samples:
        return None
    return max(samples, key=lambda s: (s.taken_at, s.id)).ph


def ph_mean(pit: Pit) -> float | None:
    """全部未作废记录的算术平均；无记录返回 None（专页留空）。"""
    samples = valid_samples(pit)
    if not samples:
        return None
    return sum(s.ph for s in samples) / len(samples)


def sample_count(pit: Pit) -> int:
    return len(valid_samples(pit))


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


def find_race_conflict(pit: Pit, operator: str):
    """两名工抢着给同一坑登记时，返回已入库的那条冲突记录；无冲突返回 None。

    调用方必须先对该坑上行锁（select_for_update），并发下判定才可靠。
    """
    now = timezone.now()
    recent = pit.samples.filter(voided=False, taken_at__gte=now - RACE_WINDOW)
    for sample in recent:
        if sample.operator != operator or sample.taken_at >= now - RETRY_WINDOW:
            return sample
    return None
