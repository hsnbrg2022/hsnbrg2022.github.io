const FED_STALE_DAYS = 45;

function card(data, id) {
  return data.cards.find((item) => item.id === id);
}

function daysSince(dateString, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString || "")) return Infinity;
  return Math.floor((now.getTime() - new Date(`${dateString}T23:59:59Z`).getTime()) / 86_400_000);
}

function shortDate(dateString) {
  const [, month, day] = String(dateString).split("-");
  return `${Number(month)}/${Number(day)}`;
}

function meetingLabel(meeting) {
  if (!meeting?.startDate || !meeting?.endDate) return "待官方公布";
  return `${shortDate(meeting.startDate)}–${shortDate(meeting.endDate)}`;
}

function actionText(action) {
  return { cut: "降息", hold: "维持利率", hike: "加息" }[action] || "决策待确认";
}

function toneText(tone) {
  return { dovish: "基调偏鸽", hawkish: "基调偏鹰", neutral: "基调中性" }[tone] || "基调待确认";
}

export function validateFedDataset(dataset) {
  if (dataset?.schemaVersion !== 1) throw new Error("Fed 数据版本无效");
  if (!dataset.fomc?.eventDate || !["cut", "hold", "hike"].includes(dataset.fomc.action)) {
    throw new Error("Fed 数据缺少有效 FOMC 决策");
  }
  const range = dataset.fomc.targetRange;
  if (!Number.isFinite(range?.lower) || !Number.isFinite(range?.upper) || range.lower > range.upper) {
    throw new Error("Fed 目标利率区间无效");
  }
  if (dataset.chair && !["dovish", "neutral", "hawkish"].includes(dataset.chair.tone)) {
    throw new Error("Fed 主席讲话基调无效");
  }
  return dataset;
}

export function applyFedDatasetToDashboard(data, dataset, { now = new Date() } = {}) {
  validateFedDataset(dataset);
  const target = card(data, 4);
  if (!target) throw new Error("看板缺少 Fed 卡片");

  const decision = actionText(dataset.fomc.action);
  const chairTone = dataset.chair ? toneText(dataset.chair.tone) : "暂无主席最新讲话";
  const newestEventDate = [dataset.fomc.eventDate, dataset.chair?.eventDate].filter(Boolean).sort().at(-1);
  const range = dataset.fomc.targetRange;

  target.title = "Fed 官方立场";
  target.status = dataset.fomc.action === "cut" ? "green" : dataset.fomc.action === "hike" ? "red" : "yellow";
  target.headline = `${decision} · 主席${chairTone}`;
  target.facts = [
    `目标区间 ${range.lower.toFixed(2)}%–${range.upper.toFixed(2)}%`,
    `FOMC ${shortDate(dataset.fomc.eventDate)}：${decision}`,
    ...(dataset.chair ? [`主席 ${shortDate(dataset.chair.eventDate)}：${toneText(dataset.chair.tone)}`] : []),
    `下次会议 ${meetingLabel(dataset.nextMeeting)}`
  ];
  target.detail = "FOMC 集体决策决定状态灯；主席讲话仅作语气辅助，不能覆盖实际利率行动。";
  target.change = `${decision}${dataset.chair ? ` · 主席${dataset.chair.tone === "hawkish" ? "偏鹰" : dataset.chair.tone === "dovish" ? "偏鸽" : "中性"}` : ""}`;
  target.source = { label: "Federal Reserve", url: dataset.fomc.url };
  target.refresh = "auto";
  target.dataAsOf = newestEventDate;
  target.marketFetchedAt = dataset.generatedAt;
  target.refreshStatus = daysSince(newestEventDate, now) > FED_STALE_DAYS ? "stale" : "ok";
  target.refreshMessage = `Fed / Federal Reserve · 截至 ${newestEventDate}`;
  return target.refreshStatus === "stale" ? "Fed 官方数据可能滞后 / Federal Reserve" : "Fed / Federal Reserve";
}
