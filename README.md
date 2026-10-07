# TanPit-01 · 南冈鞣场

鞣坑场地图作业台。登录后是按行列铺开的坑位，点坑登记浸液酸碱度并改状态。

## 技术栈

| 层 | 技术 |
| --- | --- |
| Web API | Django 5 · Django Ninja（不是 DRF 视图集） |
| 结构 | Django app `pits`：models / rules / api 分文件 |
| 数据 | Django ORM · PostgreSQL 15 |
| 前端 | Lit 3 Web Component · Vite |
| 部署 | Docker Compose |

## 路径与端口

- 前端：http://localhost:4770
- API：http://localhost:8770
- PostgreSQL：localhost:6170

## 演示账号

`admin` / `123456`，`worker` / `123456`

## 业务规则

- 坑不可标「已放液」，除非最近一次浸液酸碱度在 **3.5～5.0**。规则在 `backend/pits/rules.py`。
- 顶栏可在「坑位场地图」与「酸碱均值」两页间切换。每坑场地图卡片挂一块**最近酸碱贴片**，等于该坑时刻最晚一条未作废酸碱；均值页按坑列出全部未作废酸碱的算术平均（空坑无记录则留空，不写样例）。贴片与均值在 `/api/board` 同一次取数里由同一批库记录算出。
- 抽屉登记酸碱后，贴片与均值随同一批新记录一起重算。
- 两名工并发给同一坑登记时，后端以坑行 `SELECT … FOR UPDATE NOWAIT` 互斥，只许一条入库；败者收到 409，贴片与均值只跟入库那条走。
- 作废：`LiquorSample.voided_at` 非空即作废，不进贴片与均值（改坑态不看贴片规矩）。

## 快速启动

```bash
cd TanPit/TanPit-01
docker compose up --build
```
