# 古法纸浆发酵批次管理

一批原料可同时照看多口缸，记录每缸水位、温度和上次换水时间。

运行：

```bash
npm start
```

访问 `http://localhost:3039`。数据保存在 `data/paper-pulp-fermentation.json`。

## 文件划分

- `batch.js` —— 批次判定业务规则（缸位占用、换水间隔、整批暂停、待处理）
- `store.js` —— 文件存储（首次加载自动把旧版“一条一口缸”记录迁移成批次）
- `page.js` —— 页面操作（建档、逐缸观察/换水、待处理审批、筛选统计）
- `server.js` —— HTTP 路由，只做收发

## 业务规则

- 一个批次可登记多口缸，逐缸记录水位、温度、上次换水时间和观察历史。
- 同一口缸不能出现在两个未结束批次中；批次结束（状态改为“已结束”）后释放缸位。
- 换水间隔不足 2 天（48 小时，见 `MIN_WATER_CHANGE_HOURS`）时，换水申请停在“待处理”，可人工执行或取消；执行时仍重新校验间隔。
- 任一缸出现霉点或水位低于 10cm（见 `LOW_WATER_CM`）时，整批暂停换水；暂停只拦换水，其他缸的观察照常追加。
- 原有功能保留：建档、按状态/暂停/待处理筛选、关键词搜索、状态统计，并增加在管缸位、暂停批次、待处理换水、异常缸位指标。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/batches` | 批次列表（含每缸实时状态） |
| POST | `/api/batches` | 建档，body：`code, source, owner, days, status, vats[{name,waterLevel,temperature}]` |
| PATCH | `/api/batches/:id` | 更新状态等；状态改为“已结束”即释放缸位 |
| POST | `/api/batches/:id/vats/:缸名/observations` | 逐缸观察，body：`waterLevel, temperature, mold, changeWater, note`，返回换水判定 `done/pending/paused/skipped` |
| POST | `/api/batches/:id/pending/:pendingId` | 待处理换水审批，body：`{decision:"execute"}` 或 `{decision:"cancel"}` |
| GET | `/api/stats` | 统计 |
