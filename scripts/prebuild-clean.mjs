import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 빌드 전에 dist 를 지운다.
 *
 * 왜 이렇게까지 하는가:
 * 1. dist 가 남아 있으면 vite 가 산출물을 비우는 단계에서 프로세스째 죽고(Windows 0xC0000409),
 *    낡은 번들이 그대로 남는다. 셸 파이프로 출력을 넘기면 종료 코드가 가려져
 *    "빌드 성공" 으로 보이므로 낡은 번들로 e2e 를 돌리는 사고가 난다.
 * 2. 그런데 이 개발 PC 의 Node 24 는 **경로에 한글이 들어 있으면 fs.rmSync 자체가
 *    같은 방식으로 죽는다**(d:\tmp\한글only 재현, ASCII 경로는 정상).
 *    그래서 Windows 에서는 Node 대신 OS 의 rmdir 를 쓴다. Unicode 경로를 문제없이 다룬다.
 */
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

if (existsSync(dist)) {
  if (process.platform === 'win32') {
    execFileSync('cmd', ['/d', '/s', '/c', 'rmdir', '/s', '/q', dist], { stdio: 'inherit' });
  } else {
    rmSync(dist, { recursive: true, force: true });
  }
}

if (existsSync(dist)) {
  console.error(`빌드 전 정리 실패: ${dist} 를 지우지 못했습니다.`);
  process.exit(1);
}
