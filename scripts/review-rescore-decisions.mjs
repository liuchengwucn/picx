#!/usr/bin/env node
/**
 * 人工复核步骤：对 backfill-rescore-rejected.mjs 的 dry-run 决策做减法。
 * 新 prompt 仍会放行少数与人工标注（docs/calib/news-taste-bench.jsonl）直接冲突的条目
 * ——主要是中文单团队宣传文、纯融资轮、教程。这里按标注口径把它们剔除，
 * 只保留与 taste 一致的回捞集，并打印每条被剔除的理由供审计。
 *
 * Usage: node scripts/review-rescore-decisions.mjs <in.json> <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , IN, OUT] = process.argv;
if (!IN || !OUT) {
  console.error("usage: node scripts/review-rescore-decisions.mjs <in.json> <out.json>");
  process.exit(1);
}

// 每条 = [标题匹配, 剔除理由]。理由对应 bench 里的既有标注类别。
const DROP = [
  [/Multi-Vector \(Late Interaction\)/i, "教程类（bench 明确标 exclude）"],
  [/Zetta/i, "机器人单团队宣传文"],
  [/PhiZero/i, "单团队宣传文"],
  [/AI Infra进入自进化时代/, "单团队宣传文"],
  [/世界模型进入.{0,3}有声时代/, "单团队宣传文（HelixWorld）"],
  [/MemoraX Code/i, "单团队宣传文"],
  [/Vibe Gaming/i, "单团队宣传文"],
  [/华尔街实测8款/, "量子位宣传稿（gist 自述 promotional）"],
  [/一段视频，重建一个可仿真的动态世界/, "外围 CV 单团队论文（按主题区分应拒）"],
  [/Groq rais|Groq raised/i, "纯融资轮"],
  [/Fractile/i, "纯融资洽谈"],
  [/Mercor/i, "纯融资/投资洽谈"],
  [/Situational Awareness/i, "二级市场股权折价，财经类"],
  [/El Paso data center/i, "基建融资/保险，财经类"],
  [/SpaceX approached AI coding startup Cognition/i, "仅收购洽谈，未达成（新 prompt 只豁免已达成/完成）"],
];

const rows = JSON.parse(readFileSync(IN, "utf8"));
let dropped = 0;
for (const r of rows) {
  if (!r.flip) continue;
  const hit = DROP.find(([re]) => re.test(r.title));
  if (hit) {
    r.flip = false;
    r.dropReason = hit[1];
    dropped++;
    console.log(`  剔除 ${r.oldScore}→${r.newScore} [${r.src}] ${r.title.slice(0, 56)}  —— ${hit[1]}`);
  }
}
writeFileSync(OUT, JSON.stringify(rows, null, 1));
const kept = rows.filter((r) => r.flip).length;
console.log(`\n复核后：保留 ${kept} 条回捞，剔除 ${dropped} 条`);
console.log(`已写入 ${OUT}`);
