// 启 5 · 照着线开车：反过来读位置-时间图。三关：往上再平 → 往下（往回开） → 从东边出发穿过家门口到西边
import { Fig, start } from '../ui.js';
import { segTrip, matchFig, beats, kidGuesses, kidQuiz, kidChrome } from '../kid.js';
import { KGEN } from './problems.js';

kidChrome(5);
const B = beats();
const G = kidGuesses({
  g1: { right: 1, later: true, wait: '记下了。开到第二关，答案自己会出来。', text: '线往下的时候，你的手在往西拖：车在往回开。路一直是平的，没有坡。' },
  g2: { right: 1, text: '往上是往东开，往下是往回开。连起来就是出去一趟又回来。山包只是线的样子。' },
  g3: { right: 0, text: '线平，说明位置没变，车停着。停在哪，看线有多高：东 30 米。' },
});

matchFig(Fig, {
  canvas: 'c1', again: 'again1', hint: 'hint1', dur: 5, lo: -10, hi: 50,
  target: segTrip([[3, 10], [2, 0]]),
  notes: [[1.4, 26, '往上：往东开'], [4, 36, '平：停住']],
  onDone: () => B.unlock('b2', '开完了。'),
});
matchFig(Fig, {
  canvas: 'c2', again: 'again2', hint: 'hint2', dur: 6, lo: -10, hi: 50,
  target: segTrip([[2, 15], [1, 0], [3, -10]]),
  notes: [[4.6, 26, '往下：？']],
  onDone: () => { B.unlock('b3', '开完了。'); G.reveal('g1'); G.echo('g1', 'echo1'); },
});
matchFig(Fig, {
  canvas: 'c3', again: 'again3', hint: 'hint3', dur: 5, lo: -20, hi: 50,
  target: segTrip([[2, -15], [1, 0], [2, -10]], 40),
  notes: [[4.2, -16, '家的西边', 'center']],
  onDone: () => B.unlock('b5', '开完了。'),
});

kidQuiz(5, KGEN[5]);
start();
