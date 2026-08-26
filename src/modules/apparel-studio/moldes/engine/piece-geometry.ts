import type { PieceTemplateKind, PointCm } from '../types';

function pathFromPoints(points: PointCm[], close = true): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  let d = `M ${first.x} ${first.y}`;
  for (const p of rest) {
    d += ` L ${p.x} ${p.y}`;
  }
  if (close) d += ' Z';
  return d;
}

/** Panel frente con sisa (paramétrico) */
function panelFrente(m: Record<string, number>): { path: string; viewBox: string } {
  const w = m['ancho-axila'] ?? 49;
  const h = m['alto-total'] ?? 71;
  const sisa = m['sisa'] ?? 21;
  const points: PointCm[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h - sisa },
    { x: w * 0.75, y: h },
    { x: w * 0.25, y: h },
    { x: 0, y: h - sisa },
  ];
  return { path: pathFromPoints(points), viewBox: `0 0 ${w} ${h}` };
}

function panelEspalda(m: Record<string, number>): { path: string; viewBox: string } {
  return panelFrente(m);
}

function mangaSetIn(m: Record<string, number>): { path: string; viewBox: string } {
  const largo = m['largo'] ?? 21;
  const cabeza = m['ancho-cabeza'] ?? 40;
  const puno = m['ancho-puno'] ?? 15;
  const points: PointCm[] = [
    { x: 0, y: 0 },
    { x: cabeza, y: 0 },
    { x: puno + (cabeza - puno) * 0.3, y: largo },
    { x: puno, y: largo },
  ];
  return { path: pathFromPoints(points), viewBox: `0 0 ${cabeza} ${largo}` };
}

function mangaRaglan(m: Record<string, number>): { path: string; viewBox: string } {
  const largo = m['largo'] ?? 22;
  const ancho = m['ancho-cabeza'] ?? 42;
  const points: PointCm[] = [
    { x: 0, y: 0 },
    { x: ancho, y: 0 },
    { x: ancho * 0.6, y: largo },
    { x: ancho * 0.2, y: largo },
  ];
  return { path: pathFromPoints(points), viewBox: `0 0 ${ancho} ${largo}` };
}

function mangaPuno(m: Record<string, number>): { path: string; viewBox: string } {
  const ancho = m['ancho'] ?? 16;
  const alto = m['alto'] ?? 4;
  const path = `M 0 0 L ${ancho} 0 L ${ancho} ${alto} L 0 ${alto} Z`;
  return { path, viewBox: `0 0 ${ancho} ${alto}` };
}

function mangaElastico(m: Record<string, number>): { path: string; viewBox: string } {
  const base = mangaSetIn(m);
  const largo = m['largo'] ?? 58;
  const cabeza = m['ancho-cabeza'] ?? 40;
  const puno = m['ancho-puno'] ?? 12;
  const wave = puno * 0.12;
  const ribPath = `M ${puno} ${largo - 2} Q ${puno + cabeza * 0.15} ${largo - 2 - wave} ${puno + cabeza * 0.3} ${largo - 2} Q ${puno + cabeza * 0.45} ${largo - 2 + wave} ${puno + cabeza * 0.3} ${largo - 2}`;
  return {
    path: `${base.path} ${ribPath}`,
    viewBox: base.viewBox,
  };
}

function mangaCierre(m: Record<string, number>): { path: string; viewBox: string } {
  const base = mangaSetIn(m);
  const largo = m['largo'] ?? 58;
  const cabeza = m['ancho-cabeza'] ?? 42;
  const cierreLen = m['largo-cierre'] ?? 18;
  const cx = cabeza * 0.15;
  const zipPath = `M ${cx} ${largo - cierreLen} L ${cx} ${largo - 2}`;
  return {
    path: `${base.path} ${zipPath}`,
    viewBox: base.viewBox,
  };
}

function cuelloRedondo(m: Record<string, number>): { path: string; viewBox: string } {
  const per = m['perimetro'] ?? 42;
  const alto = m['alto'] ?? 3;
  const w = per / Math.PI;
  const path = `M 0 ${alto} Q ${w / 2} 0 ${w} ${alto} L ${w} ${alto * 2} L 0 ${alto * 2} Z`;
  return { path, viewBox: `0 0 ${w} ${alto * 2}` };
}

function cuelloV(m: Record<string, number>): { path: string; viewBox: string } {
  const ancho = m['ancho-apertura'] ?? 18;
  const prof = m['profundidad'] ?? 12;
  const points: PointCm[] = [
    { x: 0, y: 0 },
    { x: ancho, y: 0 },
    { x: ancho / 2, y: prof },
  ];
  return { path: pathFromPoints(points, false), viewBox: `0 0 ${ancho} ${prof}` };
}

function cuelloPolo(m: Record<string, number>): { path: string; viewBox: string } {
  const ancho = m['ancho-cuello'] ?? 42;
  const alto = m['alto-cuello'] ?? 8;
  const path = `M 0 ${alto} L ${ancho} ${alto} L ${ancho} 0 L ${ancho * 0.7} ${alto * 0.3} L ${ancho * 0.3} ${alto * 0.3} Z`;
  return { path, viewBox: `0 0 ${ancho} ${alto}` };
}

function cuelloMediaPolera(m: Record<string, number>): { path: string; viewBox: string } {
  const ancho = m['ancho-cuello'] ?? 40;
  const alto = m['alto-cuello'] ?? 6;
  const tapeta = m['largo-tapeta'] ?? 18;
  const path = `M 0 ${alto + tapeta} L ${ancho * 0.35} ${alto + tapeta} L ${ancho * 0.35} ${alto} L ${ancho * 0.65} ${alto} L ${ancho * 0.65} ${alto + tapeta} L ${ancho} ${alto + tapeta} L ${ancho} 0 L 0 0 Z`;
  return { path, viewBox: `0 0 ${ancho} ${alto + tapeta}` };
}

function cuelloPolera(m: Record<string, number>): { path: string; viewBox: string } {
  const ancho = m['ancho-cuello'] ?? 42;
  const alto = m['alto-cuello'] ?? 8;
  const tapeta = m['largo-tapeta'] ?? 35;
  const path = `M 0 ${alto + tapeta} L ${ancho * 0.3} ${alto + tapeta} L ${ancho * 0.3} ${alto} L ${ancho * 0.7} ${alto} L ${ancho * 0.7} ${alto + tapeta} L ${ancho} ${alto + tapeta} L ${ancho} 0 L 0 0 Z`;
  return { path, viewBox: `0 0 ${ancho} ${alto + tapeta}` };
}

function cuelloMao(m: Record<string, number>): { path: string; viewBox: string } {
  const per = m['perimetro'] ?? 42;
  const alto = m['alto'] ?? 4;
  const solapa = m['solapa'] ?? 2.5;
  const w = per / Math.PI;
  const path = `M 0 ${alto} L ${w} ${alto} L ${w} ${alto - solapa} L 0 ${alto - solapa} Z`;
  return { path, viewBox: `0 0 ${w} ${alto}` };
}

function cuelloBaseball(m: Record<string, number>): { path: string; viewBox: string } {
  const per = m['perimetro'] ?? 44;
  const alto = m['alto'] ?? 5;
  const w = per / Math.PI;
  const path = `M 0 ${alto} L ${w} ${alto} L ${w * 0.85} ${alto * 0.4} L ${w * 0.15} ${alto * 0.4} Z`;
  return { path, viewBox: `0 0 ${w} ${alto}` };
}

function cuelloRib(m: Record<string, number>): { path: string; viewBox: string } {
  const per = m['perimetro'] ?? 40;
  const alto = m['alto'] ?? 4;
  const w = per / Math.PI;
  const wave = alto * 0.15;
  const path = `M 0 ${alto} Q ${w * 0.25} ${alto - wave} ${w * 0.5} ${alto} Q ${w * 0.75} ${alto + wave} ${w} ${alto} L ${w} 0 Q ${w * 0.75} ${wave} ${w * 0.5} 0 Q ${w * 0.25} ${-wave} 0 0 Z`;
  return { path, viewBox: `0 0 ${w} ${alto}` };
}

function cuelloCierre(m: Record<string, number>): { path: string; viewBox: string } {
  const per = m['perimetro'] ?? 42;
  const alto = m['alto'] ?? 4;
  const cierre = m['largo-cierre'] ?? 20;
  const w = per / Math.PI;
  const path = `M 0 ${alto} Q ${w / 2} 0 ${w} ${alto} L ${w} ${alto + cierre} L ${w * 0.55} ${alto + cierre} L ${w * 0.55} ${alto} L ${w * 0.45} ${alto} L ${w * 0.45} ${alto + cierre} L 0 ${alto + cierre} Z`;
  return { path, viewBox: `0 0 ${w} ${alto + cierre}` };
}

function cuelloBotones(m: Record<string, number>): { path: string; viewBox: string } {
  const per = m['perimetro'] ?? 42;
  const alto = m['alto'] ?? 4;
  const w = per / Math.PI;
  const path = `M 0 ${alto} Q ${w / 2} 0 ${w} ${alto} L ${w} ${alto * 2} L ${w * 0.52} ${alto * 2} L ${w * 0.52} ${alto} L ${w * 0.48} ${alto} L ${w * 0.48} ${alto * 2} L 0 ${alto * 2} Z`;
  return { path, viewBox: `0 0 ${w} ${alto * 2}` };
}

function cuelloCombinado(m: Record<string, number>): { path: string; viewBox: string } {
  const per = m['perimetro'] ?? 42;
  const ext = m['alto-exterior'] ?? 3;
  const int = m['alto-interior'] ?? 2;
  const w = per / Math.PI;
  const h = ext + int;
  const path = `M 0 ${h} Q ${w / 2} 0 ${w} ${h} L ${w} ${int} Q ${w / 2} ${ext * 0.3} 0 ${int} Z`;
  return { path, viewBox: `0 0 ${w} ${h}` };
}

function cuelloBicolorBanda(m: Record<string, number>): { path: string; viewBox: string } {
  const per = m['perimetro'] ?? 42;
  const alto = m['alto'] ?? 2;
  const w = per / Math.PI;
  const path = `M 0 ${alto} Q ${w / 2} 0 ${w} ${alto} L ${w} ${alto * 2} L 0 ${alto * 2} Z`;
  return { path, viewBox: `0 0 ${w} ${alto * 2}` };
}

function cuelloTricolorBanda(m: Record<string, number>): { path: string; viewBox: string } {
  return cuelloBicolorBanda(m);
}

function cuelloPersonalizado(m: Record<string, number>): { path: string; viewBox: string } {
  const apertura = m['ancho-apertura'] ?? 0;
  const prof = m['profundidad'] ?? 0;
  if (apertura > 0 && prof > 0) return cuelloV(m);
  return cuelloRedondo(m);
}

function pretina(m: Record<string, number>): { path: string; viewBox: string } {
  const largo = m['largo-total'] ?? 78;
  const alto = m['alto'] ?? 4;
  const path = `M 0 0 L ${largo} 0 L ${largo} ${alto} L 0 ${alto} Z`;
  return { path, viewBox: `0 0 ${largo} ${alto}` };
}

function shortDelantero(m: Record<string, number>): { path: string; viewBox: string } {
  const ancho = m['ancho'] ?? 26;
  const alto = m['alto-total'] ?? 48;
  const tiro = m['tiro-delantero'] ?? 27;
  const points: PointCm[] = [
    { x: 0, y: 0 },
    { x: ancho, y: 0 },
    { x: ancho, y: alto - tiro * 0.3 },
    { x: ancho * 0.5, y: alto },
    { x: 0, y: tiro },
  ];
  return { path: pathFromPoints(points), viewBox: `0 0 ${ancho} ${alto}` };
}

function shortTrasero(m: Record<string, number>): { path: string; viewBox: string } {
  const ancho = m['ancho'] ?? 28;
  const alto = m['alto-total'] ?? 50;
  const tiro = m['tiro-trasero'] ?? 31;
  const points: PointCm[] = [
    { x: 0, y: 0 },
    { x: ancho, y: 0 },
    { x: ancho, y: alto - tiro * 0.2 },
    { x: ancho * 0.5, y: alto },
    { x: 0, y: tiro * 0.9 },
  ];
  return { path: pathFromPoints(points), viewBox: `0 0 ${ancho} ${alto}` };
}

function calzaPanel(m: Record<string, number>): { path: string; viewBox: string } {
  const ancho = m['ancho-cadera'] ?? 28;
  const largo = m['largo'] ?? 95;
  const rodilla = m['ancho-rodilla'] ?? 20;
  const points: PointCm[] = [
    { x: 0, y: 0 },
    { x: ancho, y: 0 },
    { x: rodilla + 2, y: largo * 0.55 },
    { x: rodilla, y: largo },
    { x: rodilla * 0.85, y: largo },
    { x: 0, y: largo * 0.5 },
  ];
  return { path: pathFromPoints(points), viewBox: `0 0 ${ancho} ${largo}` };
}

function capucha(m: Record<string, number>): { path: string; viewBox: string } {
  const ancho = m['ancho-base'] ?? 50;
  const alto = m['alto'] ?? 35;
  const path = `M 0 ${alto} Q ${ancho / 2} 0 ${ancho} ${alto} L ${ancho * 0.85} ${alto} Q ${ancho / 2} ${alto * 0.3} ${ancho * 0.15} ${alto} Z`;
  return { path, viewBox: `0 0 ${ancho} ${alto}` };
}

function bolsilloCanguro(m: Record<string, number>): { path: string; viewBox: string } {
  const ancho = m['ancho'] ?? 32;
  const alto = m['alto'] ?? 18;
  const path = `M 0 ${alto * 0.2} Q ${ancho / 2} 0 ${ancho} ${alto * 0.2} L ${ancho} ${alto} L 0 ${alto} Z`;
  return { path, viewBox: `0 0 ${ancho} ${alto}` };
}

function jerseyPanel(m: Record<string, number>): { path: string; viewBox: string } {
  const w = m['ancho-axila'] ?? 52;
  const h = m['alto-total'] ?? 74;
  const path = `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
  return { path, viewBox: `0 0 ${w} ${h}` };
}

const BUILDERS: Record<
  PieceTemplateKind,
  (m: Record<string, number>) => { path: string; viewBox: string }
> = {
  'panel-frente': panelFrente,
  'panel-espalda': panelEspalda,
  'manga-set-in': mangaSetIn,
  'manga-raglan': mangaRaglan,
  'manga-corta': mangaSetIn,
  'manga-larga': mangaSetIn,
  'manga-tres-cuartos': mangaSetIn,
  'manga-puno': mangaPuno,
  'manga-elastico': mangaElastico,
  'manga-cierre': mangaCierre,
  'cuello-redondo': cuelloRedondo,
  'cuello-v': cuelloV,
  'cuello-polo': cuelloPolo,
  'cuello-media-polera': cuelloMediaPolera,
  'cuello-polera': cuelloPolera,
  'cuello-mao': cuelloMao,
  'cuello-baseball': cuelloBaseball,
  'cuello-rib': cuelloRib,
  'cuello-cierre': cuelloCierre,
  'cuello-botones': cuelloBotones,
  'cuello-combinado': cuelloCombinado,
  'cuello-bicolor-banda': cuelloBicolorBanda,
  'cuello-tricolor-banda': cuelloTricolorBanda,
  'cuello-personalizado': cuelloPersonalizado,
  canesú: cuelloPolo,
  capucha,
  'bolsillo-canguro': bolsilloCanguro,
  pretina,
  'short-delantero': shortDelantero,
  'short-trasero': shortTrasero,
  'calza-panel': calzaPanel,
  'pantalon-delantero': shortDelantero,
  'pantalon-trasero': shortTrasero,
  'chaleco-panel': panelFrente,
  'campera-panel': panelFrente,
  'rompevientos-panel': panelFrente,
  'jersey-panel': jerseyPanel,
  'egresados-panel': jerseyPanel,
};

export function buildPieceOutline(
  kind: PieceTemplateKind,
  medidas: Record<string, number>
): { path: string; viewBox: string } | null {
  const builder = BUILDERS[kind];
  if (!builder) return null;
  return builder(medidas);
}

export function medidasToRecord(
  medidas: { key: string; valorCm: number }[]
): Record<string, number> {
  return Object.fromEntries(medidas.map((m) => [m.key, m.valorCm]));
}
