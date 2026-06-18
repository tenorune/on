/**
 * @jest-environment node
 */
const fs = require('fs');
const path = require('path');
const { renderAbout } = require('../scripts/build.js');

describe('renderAbout substitution', () => {
  const tpl = 'T:__APP_TITLE__ R:__DATA_REGION__ M:__ABOUT_MADE_BY__';

  test('fills title and region', () => {
    const out = renderAbout(tpl, { APP_TITLE: 'KnockKnock', DATA_REGION: 'europe-west1', ABOUT_AUTHOR: 'Alex K.' });
    expect(out).toContain('T:KnockKnock');
    expect(out).toContain('R:europe-west1');
  });

  test('made-by includes the author when set', () => {
    const out = renderAbout(tpl, { APP_TITLE: 'X', DATA_REGION: 'r', ABOUT_AUTHOR: 'Alex K.' });
    expect(out).toContain('Made by Alex K. with a little help from Claude');
  });

  test('made-by degrades gracefully when author is unset', () => {
    const out = renderAbout(tpl, { APP_TITLE: 'X', DATA_REGION: 'r', ABOUT_AUTHOR: '' });
    expect(out).toContain('Made with a little help from Claude');
    expect(out).not.toContain('Made by ');
    expect(out).not.toContain('__ABOUT_MADE_BY__');
  });

  test('region degrades gracefully when unset', () => {
    const out = renderAbout(tpl, { APP_TITLE: 'X', DATA_REGION: '', ABOUT_AUTHOR: '' });
    expect(out).toContain('a Google Cloud region');
    expect(out).not.toContain('__DATA_REGION__');
  });

  test('escapes HTML in author and title', () => {
    const out = renderAbout('__ABOUT_MADE_BY__ __APP_TITLE__', { APP_TITLE: '<b>', DATA_REGION: 'r', ABOUT_AUTHOR: '<i>' });
    expect(out).not.toContain('<b>');
    expect(out).not.toContain('<i>');
    expect(out).toContain('&lt;');
  });
});
