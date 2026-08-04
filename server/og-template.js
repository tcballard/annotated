// OG card (1200x630) for annotated permalinks, "muted 2006" system.
// This is the ESM equivalent of the approved redesign handoff bundle.

const T = {
  chrome: '#5C6B87', chromeDark: '#4E5C75', chromeText: '#DDE2EB',
  paper: '#F3F1EA', module: '#E9EBF0', moduleSoft: '#F0F1F4',
  border: '#C9CDD6', ink: '#33383F', inkSoft: '#3E444E',
  meta: '#7A8089', accent: '#B0674D', accentSoft: '#E0A48E', white: '#FCFCFA',
};

const el = (type, style, children) => ({ type, props: { style, children } });
const txt = (style, value) => el('div', style, value);

function quoteSize(quote) {
  if (quote.length <= 70) return 52;
  if (quote.length <= 120) return 44;
  if (quote.length <= 180) return 38;
  return 32;
}

const clip = (value, length) => value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;

export function annotationCard(annotation) {
  const quote = clip(annotation.quote, 240);
  const note = clip(annotation.note, 140);
  const sans = 'CardSans';
  const mono = 'CardMono';

  return el('div', {
    width: 1200, height: 630, display: 'flex', flexDirection: 'column',
    backgroundColor: T.paper, fontFamily: sans, color: T.ink,
  }, [
    el('div', {
      height: 64, backgroundColor: T.chrome, display: 'flex', alignItems: 'center', padding: '0 36px',
      borderBottom: `2px solid ${T.chromeDark}`,
    }, [
      txt({ fontSize: 28, fontWeight: 700, color: '#FFFFFF', letterSpacing: -0.5 }, 'annotated'),
      txt({ fontSize: 28, fontWeight: 700, color: T.accentSoft }, '.'),
      txt({ fontSize: 16, color: T.chromeText, marginLeft: 18, letterSpacing: 1 }, 'SOURCE-FIRST NOTES'),
    ]),
    el('div', {
      display: 'flex', flexDirection: 'column', flexGrow: 1, margin: 28,
      backgroundColor: T.white, border: `2px solid ${T.border}`,
    }, [
      el('div', {
        backgroundColor: T.module, borderBottom: `2px solid ${T.border}`, display: 'flex',
        alignItems: 'center', justifyContent: 'space-between', padding: '10px 22px',
      }, [
        txt({ fontSize: 19, fontWeight: 700 }, 'Annotation'),
        txt({ fontFamily: mono, fontSize: 16, color: T.meta, letterSpacing: 0.5 }, `${annotation.sourceDomain} · ${annotation.sourceType} · ${annotation.duration}`),
      ]),
      el('div', {
        display: 'flex', flexDirection: 'column', flexGrow: 1, padding: '26px 30px', justifyContent: 'space-between',
      }, [
        el('div', { display: 'flex', flexDirection: 'column' }, [
          el('div', { display: 'flex', marginBottom: 18 }, [
            txt({
              fontFamily: mono, fontSize: 18, fontWeight: 700, color: T.accent,
              border: `2px solid ${T.accent}`, padding: '2px 10px', letterSpacing: 1,
            }, annotation.momentLabel),
          ]),
          el('div', {
            display: 'flex', flexDirection: 'column', borderLeft: `6px solid ${T.accent}`,
            backgroundColor: T.moduleSoft, padding: '20px 26px',
          }, [
            txt({ fontSize: quoteSize(quote), lineHeight: 1.3, color: T.inkSoft }, `“${quote}”`),
            txt({ fontSize: 17, color: T.meta, marginTop: 14 }, `— ${annotation.sourceName} · ${annotation.sourceType} · at ${annotation.momentLabel.split('–')[0]}`),
          ]),
          txt({ fontSize: 22, lineHeight: 1.4, marginTop: 20, color: T.ink }, note),
        ]),
        el('div', {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '2px solid #EDEEF0', paddingTop: 16,
        }, [
          el('div', { display: 'flex', fontSize: 18 }, [
            txt({ fontWeight: 700 }, `@${annotation.author}`),
            txt({ color: T.meta, marginLeft: 8 }, 'on annotated'),
          ]),
          txt({ fontFamily: mono, fontSize: 15, color: T.meta, letterSpacing: 0.5 }, 'THE ORIGINAL IS ONE CLICK AWAY'),
        ]),
      ]),
    ]),
  ]);
}
