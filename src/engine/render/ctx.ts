/**
 * Canvas 2D 컨텍스트 중 실제로 쓰는 부분만 추린 구조적 인터페이스.
 * CanvasRenderingContext2D 가 이 형태를 만족하므로 브라우저에서 그대로 넘길 수 있고,
 * 테스트에서는 호출을 기록하는 가짜 객체로 대체할 수 있다.
 */
export interface Ctx2D {
  save(): void;
  restore(): void;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  globalAlpha: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fill(): void;
  closePath(): void;
  drawImage?(image: unknown, dx: number, dy: number, dw?: number, dh?: number): void;
}

export interface DrawSize {
  w: number;
  h: number;
}

/** 테스트에서 그리기 호출을 검증하기 위한 기록용 컨텍스트. */
export class RecordingCtx implements Ctx2D {
  calls: Array<{ op: string; args: unknown[] }> = [];
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  font = '';
  textAlign = 'left';
  textBaseline = 'alphabetic';
  globalAlpha = 1;

  private rec(op: string, ...args: unknown[]): void {
    this.calls.push({ op, args });
  }
  save(): void {
    this.rec('save');
  }
  restore(): void {
    this.rec('restore');
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rec('fillRect', x, y, w, h, this.fillStyle);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    this.rec('strokeRect', x, y, w, h);
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.rec('clearRect', x, y, w, h);
  }
  fillText(text: string, x: number, y: number): void {
    this.rec('fillText', text, x, y);
  }
  measureText(text: string): { width: number } {
    return { width: text.length * 8 };
  }
  beginPath(): void {
    this.rec('beginPath');
  }
  moveTo(x: number, y: number): void {
    this.rec('moveTo', x, y);
  }
  lineTo(x: number, y: number): void {
    this.rec('lineTo', x, y);
  }
  stroke(): void {
    this.rec('stroke');
  }
  fill(): void {
    this.rec('fill');
  }
  closePath(): void {
    this.rec('closePath');
  }
  drawImage(image: unknown, dx: number, dy: number, dw?: number, dh?: number): void {
    this.rec('drawImage', image, dx, dy, dw, dh);
  }

  texts(): string[] {
    return this.calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
  }
}
