'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { obliczWyrazenie, obliczPytanie, czyPytanieObliczeniowe } = require('../ai/calculator');
const AI_POLICY = require('../ai/policy');

test('calculation routing recognizes nested expressions and decimal commas', () => {
  for (const question of ['Policz 2*(3+4)', 'Ile to (2,5 + 1,5) / 2?', 'Oblicz 8 ÷ 2']) {
    assert.equal(AI_POLICY.okreslKategorieAI(question, () => false), 'calculation', question);
  }
  assert.notEqual(AI_POLICY.okreslKategorieAI('Ile kosztuje karta graficzna?', () => false), 'calculation');
  assert.equal(AI_POLICY.okreslKategorieAI('Policz 5 / 0', () => false), 'calculation');
  assert.equal(AI_POLICY.okreslKategorieAI('Policz 2 + process.exit()', () => false), 'calculation');
});

test('deterministic evaluator respects precedence, unary operators and parentheses', () => {
  assert.deepEqual(obliczWyrazenie('2 + 3 * 4'), { ok: true, value: 14 });
  assert.deepEqual(obliczWyrazenie('(2 + 3) * 4'), { ok: true, value: 20 });
  assert.deepEqual(obliczWyrazenie('-(2 + 3) * 2'), { ok: true, value: -10 });
  assert.deepEqual(obliczWyrazenie('2,5 + 3,25'), { ok: true, value: 5.75 });
  assert.deepEqual(obliczPytanie('Policz: (2 + 3) * 4?'), { ok: true, value: 20, expression: '(2 + 3) * 4' });
});

test('calculation evaluator rejects division by zero, injection and excessive input', () => {
  assert.equal(obliczWyrazenie('5 / 0').reason, 'division_by_zero');
  assert.equal(obliczWyrazenie('2 + process.exit()').ok, false);
  assert.equal(obliczWyrazenie('2 ** 3').ok, false);
  assert.equal(obliczWyrazenie('1'.repeat(121) + '+1').reason, 'expression_too_long');
  assert.equal(obliczWyrazenie('('.repeat(13) + '1+1' + ')'.repeat(13)).reason, 'nesting_too_deep');
  assert.equal(obliczWyrazenie('9999999999999 * 2').reason, 'number_out_of_range');
  assert.equal(obliczWyrazenie('1000000000000 * 2').reason, 'result_out_of_range');
  assert.equal(czyPytanieObliczeniowe('Ile kosztuje karta graficzna?'), false);
});
