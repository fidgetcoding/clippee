/**
 * The notes list's status icons, drawn as 16px pixel art in the Windows 98
 * idiom: a light bulb for a fix that is ready, an hourglass while one is being
 * drafted, a green tick once applied, a red cross when it failed. Authored
 * here as run-length rects, not extracted from any Microsoft asset.
 */

export type StatusIcon = 'bulb' | 'glass' | 'ok' | 'err';

const SVG_NS = 'http://www.w3.org/2000/svg';

const ART: Readonly<Record<StatusIcon, { rows: readonly string[]; pal: Readonly<Record<string, string>> }>> = {
  bulb: {
    rows: [
      '.....kkkkk......', '...kkyyyyykk....', '..kyywwyyyyyk...', '.kyywwyyyyyyyk..',
      '.kywwyyyyyyyyk..', '.kyyyyyyyyyyyk..', '.kyyyyyyyyyyyk..', '..kyyyyyyyyyk...',
      '...kyyyyyyyk....', '....kyyyyyk.....', '....kgwgwgk.....', '....kwgwgwk.....',
      '....kgwgwgk.....', '.....kkkkk......', '......kkk.......', '................',
    ],
    pal: { k: '#0e0a06', y: '#f2ad2a', w: '#ffffff', g: '#857f75' },
  },
  glass: {
    rows: [
      '.kkkkkkkkkkkk...', '.kggggggggggk...', '..kwwwwwwwwk....', '..kwyyyyyywk....',
      '...kwyyyywk.....', '....kwyywk......', '.....kwwk.......', '.....kwwk.......',
      '....kwwywk......', '...kwwwyywk.....', '..kwwwyyyywk....', '..kwyyyyyywk....',
      '.kggggggggggk...', '.kkkkkkkkkkkk...', '................', '................',
    ],
    pal: { k: '#0e0a06', g: '#857f75', w: '#ffffff', y: '#cc9600' },
  },
  ok: {
    rows: [
      '................', '..............g.', '.............gg.', '............ggg.',
      '...........ggg..', '..g.......ggg...', '..gg.....ggg....', '..ggg...ggg.....',
      '...ggg.ggg......', '....ggggg.......', '.....ggg........', '......g.........',
      '................', '................', '................', '................',
    ],
    pal: { g: '#6f8821' },
  },
  err: {
    rows: [
      '.....kkkkkk.....', '...kkrrrrrrkk...', '..krrrrrrrrrrk..', '.krrwwrrrrwwrrk.',
      '.krrwwwrrwwwrrk.', 'krrrrwwwwwwrrrrk', 'krrrrrwwwwrrrrrk', 'krrrrrwwwwrrrrrk',
      'krrrrwwwwwwrrrrk', '.krrwwwrrwwwrrk.', '.krrwwrrrrwwrrk.', '..krrrrrrrrrrk..',
      '...kkrrrrrrkk...', '.....kkkkkk.....', '................', '................',
    ],
    pal: { k: '#0e0a06', r: '#e05a2e', w: '#ffffff' },
  },
};

export function statusIcon(name: StatusIcon): SVGSVGElement {
  const { rows, pal } = ART[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `mrclippy-ic mrclippy-ic-${name}`);
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const color = pal[row[x] ?? ''];
      if (!color) {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end] === row[x]) end++;
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(end - x));
      rect.setAttribute('height', '1');
      rect.setAttribute('fill', color);
      svg.appendChild(rect);
      x = end;
    }
  });
  return svg;
}

/** The Office 97 blue bead used as a list bullet. `done` is the spent gray one. */
export function bullet(done = false): HTMLElement {
  const b = document.createElement('span');
  b.className = `mrclippy-bul${done ? ' mrclippy-bul-done' : ''}`;
  b.setAttribute('aria-hidden', 'true');
  return b;
}

/** The chunked Windows progress bar, for a fix being written. */
export function progressBar(): HTMLElement {
  const bar = document.createElement('span');
  bar.className = 'mrclippy-bar mrclippy-sunk';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Writing a fix');
  for (let i = 0; i < 9; i++) bar.appendChild(document.createElement('b'));
  return bar;
}
