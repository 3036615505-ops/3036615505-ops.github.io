#!/usr/bin/env node
/**
 * tools/check-apk.mjs — 校验 app/version.json 里的 size / sha256 与真实安装包一致
 *
 * 为什么需要它：`version.json` 是 App 更新检查的唯一数据源，里面的 sha256 用来
 * 判断「下载到的是不是我发布的那一个包」。但这两个数字是手工维护的 —— 打完包忘记
 * 改、或者改了包没改哈希，App 那边看到的就是一份永远对不上的清单，而站点上完全
 * 看不出异常（文件在、URL 通、下载也能下）。
 *
 *   node tools/check-apk.mjs            # 只检查，不一致退出码 1
 *   node tools/check-apk.mjs --write    # 按真实 APK 重算 size / sha256 并写回
 *
 * 判定：size 与实际字节数一致、sha256 与实际摘要一致。两处任一不符即失败。
 * 打新包之后跑一次 --write，再提交 version.json 与 APK —— 两者必须同一次提交。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'app', 'version.json');
const APK = path.join(ROOT, 'app', 'linyuan-latest.apk');
const write = process.argv.includes('--write');

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

if (!fs.existsSync(MANIFEST)) fail('找不到 app/version.json');
if (!fs.existsSync(APK)) fail('找不到 app/linyuan-latest.apk（安装包要跟清单一起提交）');

const buf = fs.readFileSync(APK);
const size = buf.length;
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
} catch (err) {
  fail('app/version.json 不是合法 JSON：' + err.message);
}

if (write) {
  manifest.size = size;
  manifest.sha256 = sha256;
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log('✓ 已按真实安装包写回 app/version.json');
  console.log('  size   ' + size);
  console.log('  sha256 ' + sha256);
  process.exit(0);
}

const problems = [];
if (Number(manifest.size) !== size) {
  problems.push('size 不一致：清单 ' + manifest.size + '，实际 ' + size);
}
if (String(manifest.sha256 || '').toLowerCase() !== sha256) {
  problems.push('sha256 不一致：\n    清单 ' + (manifest.sha256 || '(空)') + '\n    实际 ' + sha256);
}

if (problems.length) {
  console.error('✗ app/version.json 与安装包对不上');
  problems.forEach(function (p) { console.error('  - ' + p); });
  console.error('');
  console.error('  打新包之后跑一次：node tools/check-apk.mjs --write');
  console.error('  然后「APK + version.json」必须一起提交，否则读者拿到的校验值对不上。');
  process.exit(1);
}

console.log('✓ version.json 与实际安装包一致（' + size + ' 字节）');
