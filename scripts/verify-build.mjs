import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 빌드 산출물이 정말로 이번 실행에서 새로 만들어졌는지 확인한다.
 * 빌드가 조용히 실패하고 낡은 dist 가 남는 경우를 잡아내기 위한 마지막 방어선이다.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const MAX_AGE_MS = 10 * 60 * 1000;

function fail(message) {
  console.error(`빌드 검증 실패: ${message}`);
  process.exit(1);
}

let indexHtml;
try {
  indexHtml = readFileSync(path.join(dist, 'index.html'), 'utf8');
} catch {
  fail('dist/index.html 이 없습니다.');
}

let assets;
try {
  assets = readdirSync(path.join(dist, 'assets'));
} catch {
  fail('dist/assets 가 없습니다.');
}

const js = assets.filter((f) => f.endsWith('.js'));
const css = assets.filter((f) => f.endsWith('.css'));
if (js.length === 0) fail('JS 번들이 없습니다.');
if (css.length === 0) fail('CSS 번들이 없습니다.');

for (const file of [...js, ...css]) {
  if (!indexHtml.includes(file)) {
    fail(`index.html 이 ${file} 을 참조하지 않습니다. 낡은 산출물이 섞였을 수 있습니다.`);
  }
  const age = Date.now() - statSync(path.join(dist, 'assets', file)).mtimeMs;
  if (age > MAX_AGE_MS) {
    fail(`${file} 이 ${Math.round(age / 60000)}분 전 파일입니다. 이번 빌드에서 만들어지지 않았습니다.`);
  }
}

const sizeKb = js.reduce((n, f) => n + statSync(path.join(dist, 'assets', f)).size, 0) / 1024;
console.log(`빌드 검증 통과: JS ${js.length}개 (${sizeKb.toFixed(0)}KB), CSS ${css.length}개`);
