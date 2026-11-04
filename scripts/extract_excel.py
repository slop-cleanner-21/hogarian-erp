#!/usr/bin/env python3
"""Extrae 'CONTROL DE COSTOS V2.2.xlsm' a supabase/seed/excel.sql.

Uso (siempre en modo aislado, el xlsm es dato no confiable):
    python -I scripts/extract_excel.py <archivo.xlsm> <salida.sql> [--check-json <ruta.json>]

Solo stdlib: zipfile + xml.etree (iterparse en streaming). Se usan los valores
cacheados de las celdas (no se evalúan fórmulas). Ver docs/modelo-datos.md.
"""
import argparse
import datetime as dt
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, OrderedDict, defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
NS_REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
NS_PKG = '{http://schemas.openxmlformats.org/package/2006/relationships}'

# RUCs corregidos (la hoja DATOS repite 20607590304 para MARBELEN y ARIANT)
RUC_EMPRESA = {
    'ARIANT': '20607590304',        # confirmado en un RxH
    'MARBELEN': '20607600881',      # confirmado en una factura
}
RUBROS = ['MATERIAL', 'MANO OBRA', 'SUBCONTRATO', 'LOCACION', 'PROYECTO', 'FINALIZACION', 'OTRO']
# PROVEED.D -> tipo_comprobante (None = sin comprobante habitual)
MAP_COMPROBANTE_HABITUAL = {
    'FACTURA': 'FACTURA', 'RXH': 'RXH', 'R.HONORARIOS': 'RXH', 'BOLETA': 'BOLETA',
    'RECIBO': 'RECIBO_SIMPLE', 'RECIBO SIMPLE': 'RECIBO_SIMPLE', 'NO APLICA': None,
}
# GASTOEJEC.G -> tipo_comprobante
MAP_TIPO = {'FACTURA': 'FACTURA', 'R.HONORARIOS': 'RXH', 'RXH': 'RXH', 'BOLETA': 'BOLETA',
            'RECIBO SIMPLE': 'RECIBO_SIMPLE', 'OTRO': 'OTRO'}
D4 = Decimal('0.0001')
D2 = Decimal('0.01')

anomalias = []


def anomalia(msg):
    anomalias.append(msg)


# ---------------------------------------------------------------- lectura xlsx
def shared_strings(z):
    ss = []
    if 'xl/sharedStrings.xml' not in z.namelist():
        return ss
    for _, el in ET.iterparse(z.open('xl/sharedStrings.xml')):
        if el.tag == NS + 'si':
            ss.append(''.join(t.text or '' for t in el.iter(NS + 't')))
            el.clear()
    return ss


def sheet_paths(z):
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    target = {r.get('Id'): r.get('Target') for r in rels.iter(NS_PKG + 'Relationship')}
    out = {}
    for s in wb.iter(NS + 'sheet'):
        t = target[s.get(NS_REL + 'id')].lstrip('/')
        out[s.get('name')] = t if t.startswith('xl/') else 'xl/' + t
    return out


def read_rows(z, path, ss, cols):
    """Itera (n_fila, {col: valor_str}) solo con las columnas pedidas."""
    cols = set(cols)
    for _, el in ET.iterparse(z.open(path)):
        if el.tag != NS + 'row':
            continue
        n = int(el.get('r'))
        d = {}
        for c in el.iter(NS + 'c'):
            m = re.match(r'([A-Z]+)', c.get('r'))
            col = m.group(1)
            if col not in cols:
                continue
            t = c.get('t')
            if t == 'inlineStr':
                val = ''.join(x.text or '' for x in c.iter(NS + 't'))
            else:
                v = c.find(NS + 'v')
                val = v.text if v is not None else None
                if t == 's' and val is not None:
                    val = ss[int(val)]
                elif t == 'e':
                    val = None  # #N/A, #REF!...
            if val is not None:
                d[col] = val
        el.clear()
        if d:
            yield n, d


# ---------------------------------------------------------------- utilidades
def norm_txt(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def key_txt(s):
    return norm_txt(s).upper()


def dec(s, q=D4):
    if s is None:
        return None
    s = str(s).strip()
    if s == '':
        return None
    try:
        return Decimal(s).quantize(q, ROUND_HALF_UP)
    except InvalidOperation:
        return None


def excel_date(s):
    try:
        return dt.date(1899, 12, 30) + dt.timedelta(days=int(float(s)))
    except (TypeError, ValueError):
        return None


def q(v):
    """Literal SQL."""
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, Decimal)):
        return str(v)
    if isinstance(v, dt.date):
        return "'" + v.isoformat() + "'"
    return "'" + str(v).replace("'", "''") + "'"


def pu_efectivo(cot, apr, pu, tol):
    if cot is None:
        return None
    if pu is None or cot <= pu * (1 + tol):
        return cot
    return apr


def parcial(cant, pu_ef):
    if pu_ef is None:
        return None
    return (cant * pu_ef).quantize(D2, ROUND_HALF_UP)


def parse_comprobante(h):
    """'F001 - 0005702' -> ('F001','5702'); '0'/vacío -> None."""
    s = re.sub(r'\s+', ' ', (h or '').strip().upper())
    if s == '' or re.fullmatch(r'0+', s):
        return None
    m = re.fullmatch(r'([A-Z]{1,4}\d{1,5})\s*-\s*(\d*)', s) or re.fullmatch(r'([A-Z]{1,4}\d{1,5}) (\d+)', s)
    if not m:
        return ('S/S', s)
    serie, num = m.group(1), m.group(2)
    num = num.lstrip('0') or ('0' if num else 'S/N')
    return (serie, num)


def infer_tipo(serie):
    if serie.startswith('E'):
        return 'RXH'
    if serie.startswith('F'):
        return 'FACTURA'
    if serie.startswith('B'):
        return 'BOLETA'
    return 'OTRO'


def norm_op(i):
    s = norm_txt(i)
    s = re.sub(r'\s*([-/])\s*', r'\1', s)
    return s or None


def insert_sql(table, cols, rows, extra='', overriding=True, batch=500):
    out = []
    for k in range(0, len(rows), batch):
        chunk = rows[k:k + batch]
        out.append('insert into public.%s (%s)%s values\n  %s%s;' % (
            table, ', '.join(cols), ' overriding system value' if overriding else '',
            ',\n  '.join('(' + ', '.join(q(v) for v in r) + ')' for r in chunk),
            (' ' + extra) if extra else ''))
    return '\n'.join(out)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('xlsm')
    ap.add_argument('out_sql')
    ap.add_argument('--check-json', help='escribe {codigo: {q, r}} de GASTOPROG para validar')
    a = ap.parse_args()

    z = zipfile.ZipFile(a.xlsm)
    ss = shared_strings(z)
    sp = sheet_paths(z)

    # ---- L: catálogos
    rubros_l, tipos_l, reqs, etapas = [], [], [], []
    for n, d in read_rows(z, sp['L'], ss, 'BDF'):
        if 2 <= n <= 8 and d.get('B'):
            rubros_l.append(norm_txt(d['B']))
        if 12 <= n <= 16 and d.get('B'):
            tipos_l.append(norm_txt(d['B']))
        if n >= 2 and d.get('D'):
            reqs.append(norm_txt(d['D']))
        if n >= 2 and d.get('F'):
            etapas.append(norm_txt(d['F']))
    if rubros_l != RUBROS:
        anomalia('L!B2:B8 rubros distintos al enum: %r' % rubros_l)

    # ---- DATOS: empresas y obras
    empresas = OrderedDict()   # nombre -> [id, ruc]
    obras = OrderedDict()      # nombre -> [id, empresa]
    for n, d in read_rows(z, sp['DATOS'], ss, 'BC'):
        if 2 <= n <= 10 and d.get('B'):
            nom = key_txt(d['B'])
            ruc = norm_txt(d.get('C')) or None
            if nom in RUC_EMPRESA and ruc != RUC_EMPRESA[nom]:
                anomalia('DATOS: RUC de %s corregido %s -> %s' % (nom, ruc, RUC_EMPRESA[nom]))
                ruc = RUC_EMPRESA[nom]
            empresas[nom] = [len(empresas) + 1, ruc]
        if n >= 12 and d.get('B'):
            obras[key_txt(d['B'])] = [len(obras) + 1, key_txt(d.get('C'))]
    rucs = Counter(r for _, r in empresas.values() if r)
    for r, c in rucs.items():
        if c > 1:
            raise SystemExit('RUC de empresa duplicado: %s' % r)
    for o, (_, e) in obras.items():
        if e not in empresas:
            raise SystemExit('Obra %s con empresa desconocida %s' % (o, e))

    # ---- ITEMS
    items = OrderedDict()   # key -> dict
    titulos = []
    dup_items = 0
    for n, d in read_rows(z, sp['ITEMS'], ss, 'ABCDE'):
        if n < 3 or not norm_txt(d.get('B')):
            continue
        desc = norm_txt(d['B'])
        k = desc.upper()
        und = norm_txt(d.get('C')) or None
        rub = norm_txt(d.get('D')).upper() or None
        if und is None and rub is None:
            titulos.append((n, desc))
            continue
        if k in items:
            dup_items += 1
            anomalia('ITEMS fila %d duplicada (se conserva la primera): %s' % (n, desc))
            continue
        if rub not in RUBROS:
            anomalia('ITEMS fila %d rubro %r no válido -> OTRO' % (n, rub))
            rub = 'OTRO'
        num = dec(d.get('A'), Decimal(1))
        items[k] = dict(id=len(items) + 1, numero=int(num) if num is not None else None, descripcion=desc,
                        unidad=und, rubro=rub, tol=dec(d.get('E')) or Decimal('0'), origen='ITEMS')
    n_items_excel = len(items)

    # ---- PROVEED
    provs = OrderedDict()   # cod -> dict
    for n, d in read_rows(z, sp['PROVEED'], ss, 'BCDEF'):
        if n < 4 or not (norm_txt(d.get('B')) or norm_txt(d.get('C'))):
            continue
        cod = norm_txt(d.get('B'))
        nom = norm_txt(d.get('C'))
        if not cod:
            anomalia('PROVEED fila %d sin código: %s (omitido)' % (n, nom))
            continue
        if cod in provs:
            anomalia('PROVEED fila %d código duplicado %s (%s); se conserva la primera (%s)' % (
                n, cod, nom, provs[cod]['razon_social']))
            continue
        raw = norm_txt(d.get('D')).upper() or None
        if raw is None:
            tipo = None
        elif raw in MAP_COMPROBANTE_HABITUAL:
            tipo = MAP_COMPROBANTE_HABITUAL[raw]
        else:
            tipo = 'OTRO'
        provs[cod] = dict(id=len(provs) + 1, cod=cod, razon_social=nom or cod, tipo=tipo,
                          raw=norm_txt(d.get('D')) or None,
                          banco=norm_txt(d.get('E')) or None,
                          cuenta=norm_txt(d.get('F')).lstrip('´\'') or None, origen='PROVEED')
    n_provs_excel = len(provs)

    # ---- GASTOPROG -> partidas
    partidas = OrderedDict()  # codigo -> dict
    check = {}
    items_creados = []
    for n, d in read_rows(z, sp['GASTOPROG'], ss, 'ACEGJKLMNQR'):
        if n < 4 or not norm_txt(d.get('J')):
            continue
        cod = norm_txt(d.get('A'))
        obra = key_txt(d.get('C'))
        if not cod:
            anomalia('GASTOPROG fila %d sin código (omitida)' % n)
            continue
        if cod in partidas:
            anomalia('GASTOPROG fila %d código duplicado %s (omitida)' % (n, cod))
            continue
        if obra not in obras:
            anomalia('GASTOPROG %s obra desconocida %r (omitida)' % (cod, obra))
            continue
        desc = norm_txt(d['J'])
        k = desc.upper()
        if k not in items:
            und = norm_txt(d.get('K'))
            rub = norm_txt(d.get('L')).upper()
            items[k] = dict(id=len(items) + 1, numero=None, descripcion=desc,
                            unidad=None if und in ('', 'ERROR') else und,
                            rubro=rub if rub in RUBROS else 'OTRO', tol=Decimal('0'), origen='GASTOPROG')
            items_creados.append('%s (%s)' % (desc, cod))
        etapa = norm_txt(d.get('E')).upper()
        req = norm_txt(d.get('G')).upper() or 'REGULAR'
        if etapa not in etapas:
            anomalia('GASTOPROG %s etapa %r no está en L' % (cod, etapa))
            etapas.append(etapa)
        if req not in reqs:
            anomalia('GASTOPROG %s requerimiento %r no está en L' % (cod, req))
            reqs.append(req)
        cant = dec(d.get('M'))
        pu = dec(d.get('N'))
        if cant is None or pu is None:
            anomalia('GASTOPROG %s sin %s: %s' % (
                cod, ' ni '.join(x for x, v in (('CANT (->0)', cant), ('P.U. (->null, sin control de precio)', pu))
                                 if v is None), desc))
        partidas[cod] = dict(id=len(partidas) + 1, codigo=cod, obra=obra, etapa=etapa, req=req, item=items[k],
                             cant=cant if cant is not None else Decimal('0'), pu=pu)
        check[cod] = dict(q=float(d['Q']) if dec(d.get('Q')) is not None else None,
                          r=float(d['R']) if dec(d.get('R')) is not None else None)

    # ---- GASTOEJEC -> líneas
    lineas = []
    omitidas = Counter()
    stubs = OrderedDict()
    ultima_fecha = None
    for n, d in read_rows(z, sp['GASTOEJEC'], ss, 'ABCDEFGHIWX'):
        if n < 4 or not norm_txt(d.get('A')):
            continue
        cod = norm_txt(d['A'])
        if cod not in partidas:
            omitidas['partida inexistente'] += 1
            anomalia('GASTOEJEC fila %d partida %s inexistente (omitida)' % (n, cod))
            continue
        cant = dec(d.get('C'))
        if cant is None or cant <= 0:
            omitidas['cantidad 0/vacía'] += 1
            anomalia('GASTOEJEC fila %d (%s) cantidad %r (omitida)' % (n, cod, d.get('C')))
            continue
        fecha = excel_date(d.get('B'))
        if fecha is None:
            anomalia('GASTOEJEC fila %d (%s) sin fecha; se usa la fila anterior (%s)' % (n, cod, ultima_fecha))
            fecha = ultima_fecha
        ultima_fecha = fecha
        pcod = norm_txt(d.get('F'))
        if not pcod:
            omitidas['sin proveedor'] += 1
            anomalia('GASTOEJEC fila %d (%s) sin proveedor (omitida)' % (n, cod))
            continue
        if pcod not in provs:
            nom = norm_txt(d.get('W')) or pcod
            provs[pcod] = dict(id=len(provs) + 1, cod=pcod, razon_social=nom, tipo=None, raw=None, banco=None,
                               cuenta=None, origen='STUB')
            stubs[pcod] = nom
        p = partidas[cod]
        lineas.append(dict(fila=n, partida=p, obra=p['obra'], fecha=fecha, cant=cant,
                           pu=dec(d.get('D')), apr=dec(d.get('X')),
                           oc=re.sub(r'\s+', '', norm_txt(d.get('E')).upper()),
                           prov=provs[pcod], tipo_raw=norm_txt(d.get('G')).upper() or None,
                           comp=parse_comprobante(d.get('H')), comp_raw=norm_txt(d.get('H')),
                           op=norm_op(d.get('I'))))
    for ln in lineas:
        p = ln['partida']
        ln['pu_ef'] = pu_efectivo(ln['pu'], ln['apr'], p['pu'], p['item']['tol'])
        ln['parcial'] = parcial(ln['cant'], ln['pu_ef'])
        if ln['pu'] is None:
            anomalia('GASTOEJEC fila %d sin P.U. (línea no valorizada)' % ln['fila'])
        elif ln['pu_ef'] is None:
            anomalia('GASTOEJEC fila %d (%s) sobreprecio sin aprobar: P.U. %s > máx %s (no valorizada)' % (
                ln['fila'], p['codigo'], ln['pu'],
                (p['pu'] * (1 + p['item']['tol'])).normalize()))
        if ln['comp_raw'] and ln['comp'] is None:
            anomalia('GASTOEJEC fila %d N° comprobante %r ignorado' % (ln['fila'], ln['comp_raw']))
        elif ln['comp'] and ln['comp'][0] == 'S/S':
            anomalia('GASTOEJEC fila %d N° comprobante %r no parseable (serie S/S)' % (ln['fila'], ln['comp_raw']))
        elif ln['comp'] and ln['comp'][1] == 'S/N':
            anomalia('GASTOEJEC fila %d N° comprobante %r sin número (S/N)' % (ln['fila'], ln['comp_raw']))

    # ---- órdenes
    ordenes = OrderedDict()   # (obra, numero) -> dict
    provs_por_num = defaultdict(list)
    sn_keys = OrderedDict()
    for ln in lineas:
        if ln['oc'] in ('', 'FALTA'):
            k = (ln['obra'], ln['prov']['id'], ln['fecha'])
            if k not in sn_keys:
                sn_keys[k] = 'SN-%03d' % (len(sn_keys) + 1)
            num = sn_keys[k]
        else:
            pl = provs_por_num[(ln['obra'], ln['oc'])]
            if ln['prov']['id'] not in pl:
                pl.append(ln['prov']['id'])
            idx = pl.index(ln['prov']['id'])
            num = ln['oc'] if idx == 0 else '%s-%s' % (ln['oc'], 'ABCDEFGHIJ'[idx])
        ln['numero'] = num
        o = ordenes.setdefault((ln['obra'], num), dict(obra=ln['obra'], numero=num, prov=ln['prov'], lineas=[]))
        o['lineas'].append(ln)
    for (obra, num), pl in provs_por_num.items():
        if len(pl) > 1:
            anomalia('Orden %s/%s con %d proveedores -> sufijos -B, -C...' % (obra, num, len(pl)))
    for o in ordenes.values():
        ls = o['lineas']
        o['fecha'] = min(l['fecha'] for l in ls)
        if o['numero'].startswith('OS') or all(l['partida']['item']['rubro'] in ('MANO OBRA', 'SUBCONTRATO') for l in ls):
            o['tipo'] = 'OS'
        else:
            o['tipo'] = 'OC'
        if all(l['op'] for l in ls):
            o['estado'] = 'PAGADA'
        elif all(l['comp'] for l in ls):
            o['estado'] = 'FACTURADA'
        else:
            o['estado'] = 'PRECIOS_CONFIRMADOS'
    numeros_raros = sorted({o['numero'] for o in ordenes.values()
                            if not re.fullmatch(r'(OS)?\d{6}(-[A-Z])?|SN-\d+', o['numero'])})
    if numeros_raros:
        anomalia('Números de orden atípicos: %s' % ', '.join(numeros_raros))

    # ---- comprobantes
    grupos = OrderedDict()  # (prov_id, serie, numero) -> [lineas]
    for ln in lineas:
        if ln['comp']:
            grupos.setdefault((ln['prov']['id'], ) + ln['comp'], []).append(ln)
    comprobantes = OrderedDict()
    for (pid, serie, num), ls in grupos.items():
        tipos = Counter(MAP_TIPO.get(l['tipo_raw'], 'OTRO') for l in ls if l['tipo_raw'])
        if len(tipos) > 1:
            anomalia('Comprobante %s-%s (prov %s) con tipos mixtos %s; se usa el más frecuente' % (
                serie, num, ls[0]['prov']['razon_social'], dict(tipos)))
        if tipos:
            tipo = tipos.most_common(1)[0][0]
        else:
            # sin TIPO: comprobante habitual del proveedor; RUC 20 no emite RxH; si no, por la serie
            pv = ls[0]['prov']
            if pv['tipo'] in ('FACTURA', 'RXH', 'BOLETA'):
                tipo, por = pv['tipo'], 'comprobante habitual del proveedor'
            elif serie.startswith('E') and pv['cod'].startswith('20'):
                tipo, por = 'FACTURA', 'RUC 20 + serie E'
            else:
                tipo, por = infer_tipo(serie), 'serie'
            anomalia('Comprobante %s-%s (%s) sin TIPO; inferido %s por %s' % (
                serie, num, pv['razon_social'], tipo, por))
        emps = Counter(obras[l['obra']][1] for l in ls)
        if len(emps) > 1:
            anomalia('Comprobante %s-%s abarca varias empresas %s; se usa %s' % (
                serie, num, dict(emps), emps.most_common(1)[0][0]))
        k = (pid, tipo, serie, num)
        if k in comprobantes:  # mismo tipo tras normalizar
            comprobantes[k]['lineas'] += ls
            continue
        comprobantes[k] = dict(id=len(comprobantes) + 1, prov_id=pid, tipo=tipo, serie=serie, numero=num,
                               empresa=emps.most_common(1)[0][0], lineas=ls)
    for c in comprobantes.values():
        c['total'] = sum((l['parcial'] or Decimal(0)) for l in c['lineas'])
        c['fecha'] = max(l['fecha'] for l in c['lineas'])
        for l in c['lineas']:
            l['comp_id'] = c['id']
        if c['total'] <= 0:
            anomalia('Comprobante %s-%s total 0 (líneas no valorizadas)' % (c['serie'], c['numero']))
        nords = {(l['obra'], l['numero']) for l in c['lineas']}
        if len(nords) > 1:
            anomalia('Comprobante %s %s-%s abarca %d órdenes: %s' % (
                c['tipo'], c['serie'], c['numero'], len(nords), ', '.join('%s/%s' % x for x in sorted(nords))))

    # ---- pagos
    pagos = OrderedDict()
    for ln in lineas:
        if ln['op']:
            emp = obras[ln['obra']][1]
            pagos.setdefault((emp, ln['op']), []).append(ln)
    pagos_rows, aplic_rows = [], []
    pago_id = aplic_id = 0
    multi_comp = Counter()
    for (emp, op), ls in pagos.items():
        apl = OrderedDict()
        for l in ls:
            k = ('C', l['comp_id']) if l.get('comp_id') else ('O', l['obra'], l['numero'])
            apl[k] = apl.get(k, Decimal(0)) + (l['parcial'] or Decimal(0))
        monto = sum(apl.values())
        if monto <= 0:
            anomalia('Pago %s/%s con monto 0 (omitido)' % (emp, op))
            continue
        pago_id += 1
        provs_pago = {l['prov']['id'] for l in ls}
        if len(provs_pago) > 1:
            anomalia('Op. bancaria %s (%s) paga a %d proveedores' % (op, emp, len(provs_pago)))
        ncomp = sum(1 for k in apl if k[0] == 'C')
        if ncomp > 1:
            multi_comp[ncomp] += 1
        pagos_rows.append((pago_id, empresas[emp][0], max(l['fecha'] for l in ls), ls[0]['prov']['banco'], op, monto))
        for k, m in apl.items():
            if m <= 0:
                continue
            aplic_id += 1
            if k[0] == 'C':
                aplic_rows.append((aplic_id, pago_id, k[1], None, None, m))
            else:
                aplic_rows.append((aplic_id, pago_id, None, obras[k[1]][0], k[2], m))

    # ---- SQL
    out = []
    w = out.append
    w('-- GENERADO por scripts/extract_excel.py a partir de CONTROL DE COSTOS V2.2.xlsm. NO EDITAR.')
    w('-- Contiene RUCs y cuentas bancarias reales: no versionar (ver .gitignore).')
    w('-- Generado: %s' % dt.datetime.now().isoformat(timespec='seconds'))
    w("set app.skip_audit = 'on';")
    w(insert_sql('etapas', ['codigo', 'grupo', 'orden'],
                 [(e, re.match(r'[A-Z]+', e).group(0) if re.match(r'[A-Z]+', e) else e, i + 1) for i, e in enumerate(etapas)],
                 'on conflict (codigo) do nothing', overriding=False))
    w(insert_sql('requerimientos', ['codigo', 'orden'], [(r, i + 1) for i, r in enumerate(reqs)],
                 'on conflict (codigo) do nothing', overriding=False))
    w(insert_sql('empresas', ['id', 'nombre', 'ruc'], [(v[0], k, v[1]) for k, v in empresas.items()]))
    w(insert_sql('obras', ['id', 'nombre', 'empresa_id'], [(v[0], k, empresas[v[1]][0]) for k, v in obras.items()]))
    w(insert_sql('items', ['id', 'numero', 'descripcion', 'unidad', 'rubro', 'tolerancia_pct'],
                 [(i['id'], i['numero'], i['descripcion'], i['unidad'], i['rubro'], i['tol']) for i in items.values()]))
    w(insert_sql('proveedores', ['id', 'ruc_o_cod', 'razon_social', 'comprobante_habitual', 'comprobante_excel'],
                 [(p['id'], k, p['razon_social'], p['tipo'], p['raw']) for k, p in provs.items()]))
    # Banco y cuenta en su propia tabla (lectura restringida por rol): solo proveedores con alguno de los dos.
    w(insert_sql('proveedor_cuentas', ['proveedor_id', 'banco', 'cuenta_bancaria'],
                 [(p['id'], p['banco'], p['cuenta']) for p in provs.values() if p['banco'] or p['cuenta']],
                 overriding=False))
    w(insert_sql('partidas', ['id', 'codigo', 'obra_id', 'etapa', 'requerimiento', 'item_id', 'cantidad', 'pu'],
                 [(p['id'], k, obras[p['obra']][0], p['etapa'], p['req'], p['item']['id'], p['cant'], p['pu'])
                  for k, p in partidas.items()]))
    w(insert_sql('ordenes_compra', ['obra_id', 'numero', 'tipo', 'proveedor_id', 'fecha', 'estado'],
                 [(obras[o['obra']][0], o['numero'], o['tipo'], o['prov']['id'], o['fecha'], o['estado'])
                  for o in ordenes.values()], overriding=False))
    w(insert_sql('comprobantes', ['id', 'empresa_id', 'proveedor_id', 'tipo', 'serie', 'numero', 'fecha_emision', 'total'],
                 [(c['id'], empresas[c['empresa']][0], c['prov_id'], c['tipo'], c['serie'], c['numero'], c['fecha'], c['total'])
                  for c in comprobantes.values()]))
    w(insert_sql('oc_items', ['id', 'obra_id', 'numero_oc', 'partida_id', 'cantidad', 'pu_cotizado', 'pu_aprobado',
                              'comprobante_id'],
                 [(i + 1, obras[l['obra']][0], l['numero'], l['partida']['id'], l['cant'], l['pu'], l['apr'],
                   l.get('comp_id')) for i, l in enumerate(lineas)]))
    w(insert_sql('pagos', ['id', 'empresa_id', 'fecha', 'banco', 'numero_operacion', 'monto'], pagos_rows))
    w(insert_sql('pago_aplicaciones', ['id', 'pago_id', 'comprobante_id', 'obra_id', 'numero_oc', 'monto'], aplic_rows))
    gmax = max((int(k[1:]) for k in partidas if re.fullmatch(r'G\d+', k)), default=0)
    for t in ('empresas', 'obras', 'items', 'proveedores', 'partidas', 'oc_items', 'comprobantes', 'pagos',
              'pago_aplicaciones'):
        w("select setval(pg_get_serial_sequence('public.%s', 'id'), coalesce((select max(id) from public.%s), 0) + 1, false);" % (t, t))
    w("select setval('public.partidas_codigo_seq', %d + 1, false);" % gmax)
    w('reset app.skip_audit;')
    with open(a.out_sql, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(out) + '\n')

    if a.check_json:
        with open(a.check_json, 'w', encoding='utf-8') as f:
            json.dump(check, f)

    # ---- resumen
    est = Counter(o['estado'] for o in ordenes.values())
    tip = Counter(o['tipo'] for o in ordenes.values())
    print('== Resumen')
    print('empresas %d, obras %d, etapas %d, requerimientos %d' % (len(empresas), len(obras), len(etapas), len(reqs)))
    print('items %d (ITEMS %d + creados desde GASTOPROG %d; títulos omitidos %d; duplicados %d)' % (
        len(items), n_items_excel, len(items_creados), len(titulos), dup_items))
    print('proveedores %d (PROVEED %d + stubs %d)' % (len(provs), n_provs_excel, len(stubs)))
    print('partidas %d' % len(partidas))
    print('oc_items %d (omitidas: %s)' % (len(lineas), dict(omitidas) or 0))
    print('ordenes_compra %d  estados %s  tipos %s  sin número (SN-*) %d' % (len(ordenes), dict(est), dict(tip), len(sn_keys)))
    print('comprobantes %d  %s' % (len(comprobantes), dict(Counter(c['tipo'] for c in comprobantes.values()))))
    print('pagos %d, aplicaciones %d (a comprobante %d, a orden %d); pagos con >1 comprobante: %d' % (
        len(pagos_rows), len(aplic_rows), sum(1 for r in aplic_rows if r[2]), sum(1 for r in aplic_rows if not r[2]),
        sum(multi_comp.values())))
    print('líneas sin valorizar %d; total valorizado %s' % (
        sum(1 for l in lineas if l['parcial'] is None), sum(l['parcial'] or 0 for l in lineas)))
    if titulos:
        print('títulos de ITEMS omitidos: %s' % '; '.join('fila %d %s' % t for t in titulos))
    if items_creados:
        print('items creados: %s' % '; '.join(items_creados))
    if stubs:
        print('proveedores stub: %s' % '; '.join('%s %s' % kv for kv in stubs.items()))
    print('== Anomalías (%d)' % len(anomalias))
    for m in anomalias:
        print(' - ' + m)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
