import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, continuationPrefix, toggleMarker, indentLine, outdentLine } from '../js/lineeditor.js';

describe('parseLine', () => {
  test('記号と字下げを接頭辞として切り出す', () => {
    assert.deepEqual(parseLine('・子の看護休暇'), { indent: '', marker: '・', prefix: '・', rest: '子の看護休暇' });
    assert.deepEqual(parseLine('■育介規程'), { indent: '', marker: '■', prefix: '■', rest: '育介規程' });
    assert.deepEqual(parseLine('　・字下げ'), { indent: '　', marker: '・', prefix: '　・', rest: '字下げ' });
    assert.equal(parseLine('1. 番号').prefix, '1. ');
    assert.equal(parseLine('12）全角かっこ').prefix, '12）');
    assert.equal(parseLine('（3）かっこ番号').prefix, '（3）');
    assert.equal(parseLine('→ 補足').prefix, '→ ');
    assert.equal(parseLine('※注記').prefix, '※');
    assert.equal(parseLine('- ハイフン').prefix, '- ');
  });

  test('記号でない行は接頭辞なし（字下げのみ）', () => {
    assert.equal(parseLine('勤怠管理・在宅勤務規程').prefix, '');
    assert.equal(parseLine('1.5倍にする').prefix, '');
    assert.equal(parseLine('-5度').prefix, '');
    assert.equal(parseLine('　本文').prefix, '　');
    assert.equal(parseLine('').prefix, '');
  });
});

describe('continuationPrefix', () => {
  test('中黒・矢印などは同じ記号を引き継ぐ', () => {
    assert.equal(continuationPrefix('・項目'), '・');
    assert.equal(continuationPrefix('　・項目'), '　・');
    assert.equal(continuationPrefix('→ 補足'), '→ ');
    assert.equal(continuationPrefix('※注記'), '※');
  });

  test('番号は1つ増やす', () => {
    assert.equal(continuationPrefix('1. 一つ目'), '2. ');
    assert.equal(continuationPrefix('９．全角'), '10．');
    assert.equal(continuationPrefix('　3）字下げ'), '　4）');
  });

  test('見出し（■）と記号なしは字下げだけ引き継ぐ', () => {
    assert.equal(continuationPrefix('■育介規程'), '');
    assert.equal(continuationPrefix('　■見出し'), '　');
    assert.equal(continuationPrefix('本文'), '');
    assert.equal(continuationPrefix('　本文'), '　');
  });
});

describe('toggleMarker / indent', () => {
  test('同じ記号なら外し、違う記号なら置き換える', () => {
    assert.equal(toggleMarker('項目', '・'), '・項目');
    assert.equal(toggleMarker('・項目', '・'), '項目');
    assert.equal(toggleMarker('・項目', '■'), '■項目');
    assert.equal(toggleMarker('　項目', '1.'), '　1. 項目');
    assert.equal(toggleMarker('3. 項目', '1.'), '項目');
  });

  test('字下げは全角スペース1つ単位', () => {
    assert.equal(indentLine('・項目'), '　・項目');
    assert.equal(outdentLine('　・項目'), '・項目');
    assert.equal(outdentLine('  項目'), '項目');
    assert.equal(outdentLine('項目'), '項目');
  });
});
