const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

describe('index.html mobile enhancements', () => {
  test('includes viewport meta tag', () => {
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1">/);
  });

  test('board container disables touch action', () => {
    const styleMatch = html.match(/#board-container[^}]*\}/s);
    expect(styleMatch).not.toBeNull();
    expect(styleMatch[0]).toMatch(/touch-action:\s*none/);
  });

  test('planchette contextmenu prevented', () => {
    expect(html).toMatch(/planchetteEl\.addEventListener\('contextmenu',\s*e => e\.preventDefault\(\)/);
  });
});
