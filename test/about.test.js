import test from 'node:test';
import assert from 'node:assert/strict';
import { renderAbout, introParts, introText, firstParagraph, INTRO_MAX } from '../src/about.js';

const render = (t) => renderAbout(t).toString();

test('the intro is cut at 256 characters', () => {
  assert.equal(INTRO_MAX, 256);
});

test('paragraphs, line breaks, bold, italic and links render; everything else is escaped', () => {
  const out = render('Hi **there** and *you*.\nSecond line\n\nSee [my site](https://example.com) or https://example.org/x.');
  assert.match(out, /<p>Hi <strong>there<\/strong> and <em>you<\/em>\.<br>Second line<\/p>/);
  assert.match(out, /<a href="https:\/\/example\.com" rel="noopener nofollow ugc" target="_blank">my site<\/a>/);
  assert.match(out, /<a href="https:\/\/example\.org\/x" [^>]*>https:\/\/example\.org\/x<\/a>\./);
});

test('bulleted and numbered lists and headings', () => {
  const out = render('## Gear\n- Nikon D50\n- Nikon D300s\n\n1. First\n2. Second');
  assert.match(out, /<h3>Gear<\/h3>/);
  assert.match(out, /<ul><li>Nikon D50<\/li><li>Nikon D300s<\/li><\/ul>/);
  assert.match(out, /<ol><li>First<\/li><li>Second<\/li><\/ol>/);
});

test('HTML and script in the text cannot get through', () => {
  const out = render('<script>alert(1)</script> **<img src=x onerror=alert(1)>** [x](javascript:alert(1)) [y](https://a.com"onmouseover="alert(1))');
  assert.ok(!/<script|<img/i.test(out));
  assert.ok(!/href="javascript:/i.test(out));
  assert.ok(!/ onmouseover=/i.test(out.replace(/&quot;/g, '')) || /&quot;onmouseover/.test(out), 'quotes stay escaped');
  assert.ok(!out.includes('\u0000'));
});

test('short intros are shown whole, long ones are cut at 256 characters back to a whole word', () => {
  const short = introParts('A short intro.');
  assert.deepEqual([short.shown, short.rest, short.truncated], ['A short intro.', '', false]);

  const long = 'word '.repeat(100).trim(); // 499 characters
  const p = introParts(long);
  assert.equal(p.truncated, true);
  assert.equal(p.total, long.length);
  assert.ok(p.shown.length <= 256 && p.shown.length > 240, `shown is ${p.shown.length}`);
  assert.equal(p.shown + p.rest, long, 'shown and cut-off parts add up to the whole paragraph');
  assert.ok(introText(long).endsWith('…'));
  assert.ok(!introText('A short intro.').endsWith('…'));
});

test('the intro is plain text taken from the first paragraph, not from markers or later paragraphs', () => {
  assert.equal(firstParagraph('**Bold** start with a [link](https://example.com).\n\nSecond.'), 'Bold start with a link.');
  assert.equal(firstParagraph('## Heading only\n- one\n- two'), 'one · two', 'a list is used when there is no paragraph');
  assert.equal(introText('', 'The tagline'), 'The tagline');
});
