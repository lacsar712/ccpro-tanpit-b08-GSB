"""贴片 / 均值专页 / 抢登去重的验收测试。

本地无 PostgreSQL 时可用 sqlite 跑：
    PYTHONPATH=/tmp:. DJANGO_SETTINGS_MODULE=test_settings python -m django test pits
（/tmp/test_settings.py 里把 DATABASES 换成 sqlite 即可）
"""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from ninja.testing import TestClient

from pits.api import api
from pits.models import LiquorSample, Pit
from pits.seed import seed_demo


class TanPitCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        seed_demo()

    def setUp(self):
        self.client = TestClient(api)
        self.admin = self._token("admin")
        self.worker = self._token("worker")

    def _token(self, username):
        res = self.client.post("/auth/login", json={"username": username, "password": "123456"})
        assert res.status_code == 200, res.json()
        return {"Authorization": f"Bearer {res.json()['access_token']}"}

    def _pit(self, code):
        return Pit.objects.get(code=code)

    def _board_pit(self, code):
        res = self.client.get("/board", headers=self.admin)
        assert res.status_code == 200
        return next(p for p in res.json()["pits"] if p["code"] == code)

    def _mean_pit(self, code):
        res = self.client.get("/ph-means", headers=self.admin)
        assert res.status_code == 200
        return next(p for p in res.json()["pits"] if p["code"] == code)

    def _write(self, pit, ph, headers):
        return self.client.post(f"/pits/{pit.id}/samples", json={"ph": ph}, headers=headers)

    # --- 贴片：每坑挂最近一条未作废酸碱 ---------------------------------

    def test_board_badge_is_latest_sample(self):
        self.assertEqual(self._board_pit("东-1")["latestPh"], 4.2)
        self.assertIsNone(self._board_pit("东-2")["latestPh"])  # 空坑无贴片数字

    # --- 均值专页：算术平均、空坑为空、不写死 ---------------------------

    def test_mean_page_arithmetic_and_empty(self):
        self.assertIsNone(self._mean_pit("东-2")["meanPh"])  # 空坑无记录则为空
        self.assertEqual(self._mean_pit("中-2")["meanPh"], 6.1)
        pit = self._pit("东-2")
        LiquorSample.objects.create(pit=pit, ph=4.0, operator="worker")
        LiquorSample.objects.create(pit=pit, ph=5.0, operator="worker")
        got = self._mean_pit("东-2")
        self.assertAlmostEqual(got["meanPh"], 4.5)
        self.assertEqual(got["sampleCount"], 2)

    # --- 写入后两侧一起刷新：贴片换成新值，均值按新集合重算 --------------

    def test_write_updates_badge_and_mean_together(self):
        pit = self._pit("东-1")
        res = self._write(pit, 4.9, self.admin)
        assert res.status_code == 200, res.json()
        self.assertEqual(res.json()["latestPh"], 4.9)
        self.assertAlmostEqual(res.json()["meanPh"], (4.2 + 4.9) / 2)
        self.assertEqual(self._board_pit("东-1")["latestPh"], 4.9)  # 贴片侧
        self.assertAlmostEqual(self._mean_pit("东-1")["meanPh"], 4.55)  # 均值侧
        self.assertEqual(self._mean_pit("东-1")["sampleCount"], 2)

    # --- 两名工抢登同一坑：只许一条入库，两侧只跟这一条 ------------------

    def test_race_only_one_record_stored(self):
        pit = self._pit("西-1")
        assert self._write(pit, 4.1, self.admin).status_code == 200
        res = self._write(pit, 4.9, self.worker)  # 另一人抢登 → 拒
        self.assertEqual(res.status_code, 409)
        res = self._write(pit, 4.5, self.admin)  # 同人立刻重复提交 → 也拒
        self.assertEqual(res.status_code, 409)
        self.assertEqual(LiquorSample.objects.filter(pit=pit).count(), 1)
        self.assertEqual(self._board_pit("西-1")["latestPh"], 4.1)
        self.assertEqual(self._mean_pit("西-1")["meanPh"], 4.1)

    def test_race_window_expires(self):
        pit = self._pit("西-1")
        assert self._write(pit, 4.1, self.admin).status_code == 200
        LiquorSample.objects.filter(pit=pit).update(taken_at=timezone.now() - timedelta(seconds=5))
        res = self._write(pit, 4.9, self.worker)  # 窗口已过 → 正常入库
        assert res.status_code == 200, res.json()
        self.assertEqual(LiquorSample.objects.filter(pit=pit).count(), 2)
        self.assertEqual(self._board_pit("西-1")["latestPh"], 4.9)
        self.assertAlmostEqual(self._mean_pit("西-1")["meanPh"], 4.5)

    # --- 改坑态不看贴片规矩 ---------------------------------------------

    def test_status_change_does_not_touch_badge(self):
        pit = self._pit("中-1")
        res = self.client.post(f"/pits/{pit.id}/status", json={"status": "tanning"}, headers=self.admin)
        assert res.status_code == 200, res.json()
        self.assertEqual(res.json()["latestPh"], 4.6)
        self.assertEqual(res.json()["sampleCount"], 1)
        self.assertEqual(self._board_pit("中-1")["latestPh"], 4.6)
        self.assertEqual(self._mean_pit("中-1")["meanPh"], 4.6)

    # --- 放液门槛仍看最近一次未作废读数 ----------------------------------

    def test_drain_rule_uses_latest_valid_sample(self):
        pit = self._pit("中-2")  # 最近 6.1，超上限
        res = self.client.post(f"/pits/{pit.id}/status", json={"status": "drained"}, headers=self.admin)
        self.assertEqual(res.status_code, 400)
        assert self._write(pit, 4.0, self.admin).status_code == 200
        res = self.client.post(f"/pits/{pit.id}/status", json={"status": "drained"}, headers=self.admin)
        self.assertEqual(res.status_code, 200)

    # --- 作废记录不进贴片也不进均值 --------------------------------------

    def test_voided_sample_excluded_everywhere(self):
        pit = self._pit("东-1")
        s = LiquorSample.objects.create(pit=pit, ph=4.8, operator="worker")
        self.assertEqual(self._board_pit("东-1")["latestPh"], 4.8)
        LiquorSample.objects.filter(id=s.id).update(voided=True)
        got = self._board_pit("东-1")
        self.assertEqual(got["latestPh"], 4.2)
        self.assertEqual(got["sampleCount"], 1)
        self.assertEqual(self._mean_pit("东-1")["meanPh"], 4.2)

    # --- 接口都要登录 -----------------------------------------------------

    def test_auth_required(self):
        self.assertEqual(self.client.get("/board").status_code, 401)
        self.assertEqual(self.client.get("/ph-means").status_code, 401)
