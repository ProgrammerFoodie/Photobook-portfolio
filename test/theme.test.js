import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePalette, paletteToTheme, buildThemeCss, contrastRatio, deriveBg, DEFAULT_THEME, normalizeHex, resolveTheme } from '../src/theme.js';

test('parsePalette reads a coolors.co URL', () => {
  assert.deepEqual(parsePalette('https://coolors.co/63361e-402313-e37c44-ba6538-914f2c'),
    ['#63361E', '#402313', '#E37C44', '#BA6538', '#914F2C']);
});
test('parsePalette reads hash lists and ignores junk', () => {
  assert.deepEqual(parsePalette('#63361E, #402313 nonsense #e37'), ['#63361E', '#402313', '#EE3377']);
  assert.deepEqual(parsePalette('hello world'), []);
});
test('paletteToTheme assigns roles in order', () => {
  const t = paletteToTheme(['#111111', '#222222', '#333333']);
  assert.equal(t.surface, '#111111');
  assert.equal(t.base, '#222222');
  assert.equal(t.accent, '#333333');
  assert.equal(t.accent2, DEFAULT_THEME.accent2);
});
test('buildThemeCss rejects invalid values and falls back to defaults', () => {
  const css = buildThemeCss({ accent: 'red; } body{display:none', base: '#123456' });
  assert.ok(!css.includes('display:none'));
  assert.ok(css.includes(`--accent:${DEFAULT_THEME.accent}`));
  assert.ok(css.includes('--base:#123456'));
});
test('normalizeHex / resolveTheme', () => {
  assert.equal(normalizeHex('abc'), '#AABBCC');
  assert.equal(normalizeHex('zzz'), null);
  assert.deepEqual(resolveTheme(null), DEFAULT_THEME);
});
test('default palette keeps accessible contrast (WCAG AA)', () => {
  const bg = deriveBg(DEFAULT_THEME.base);
  assert.ok(contrastRatio(DEFAULT_THEME.text, bg) >= 4.5);
  assert.ok(contrastRatio(DEFAULT_THEME.accent, bg) >= 4.5);
});
