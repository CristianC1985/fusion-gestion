import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { collection, doc, onSnapshot, getDocs, writeBatch } from "firebase/firestore";
import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { db, auth } from "./firebase";

// ── STORAGE ───────────────────────────────────────────────────────────────────
const STORAGE_KEY   = "peluqueria-clientes-v1";
const STORAGE_CAJA  = "peluqueria-caja-v1";
const STORAGE_VALES = "peluqueria-vales-v1";
const STORAGE_PROVEEDORES  = "fusion-proveedores-v1";
const STORAGE_EFECTIVO_DIA = "fusion-efectivo-dia-v1";
const STORAGE_ULTIMO_RESPALDO = "fusion-ultimo-respaldo";
const CLAVES_RESPALDO = [STORAGE_KEY, STORAGE_CAJA, STORAGE_VALES, STORAGE_PROVEEDORES, STORAGE_EFECTIVO_DIA];
const STORAGE_MIGRADO = "fusion-migrado-nube";

// ── NUBE (Firestore) ──────────────────────────────────────────────────────────
// clave del respaldo -> colección en Firestore (un documento por registro)
const COLECCIONES = {
  [STORAGE_KEY]: "gestion_clientes",
  [STORAGE_CAJA]: "gestion_caja",
  [STORAGE_VALES]: "gestion_vales",
  [STORAGE_PROVEEDORES]: "gestion_proveedores",
  [STORAGE_EFECTIVO_DIA]: "gestion_efectivo",
};
const limpiar = (x) => JSON.parse(JSON.stringify(x)); // Firestore no acepta "undefined"

async function subirRegistros(nombre, items) {
  const lista = (Array.isArray(items) ? items : []).filter(x => x && x.id !== undefined && x.id !== null);
  for (let i = 0; i < lista.length; i += 400) {
    const batch = writeBatch(db);
    lista.slice(i, i + 400).forEach(x => batch.set(doc(db, nombre, String(x.id)), limpiar(x)));
    await batch.commit();
  }
  return lista.length;
}
async function leerColeccion(nombre) {
  const snap = await getDocs(collection(db, nombre));
  return snap.docs.map(d => d.data());
}
async function borrarColeccion(nombre) {
  const snap = await getDocs(collection(db, nombre));
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db);
    snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

// Hook: devuelve [items, setItems]. setItems funciona igual que un setState (acepta función)
// pero guarda en la nube solo los registros que cambiaron o se borraron.
function useColeccion(nombre) {
  const [items, setItems] = useState(null); // null = cargando
  const ref = useRef([]);
  useEffect(() => {
    return onSnapshot(
      collection(db, nombre),
      (snap) => { const arr = snap.docs.map(d => d.data()); ref.current = arr; setItems(arr); },
      (err) => { console.error(err); alert("No se pudieron leer los datos (" + nombre + "): " + err.message); setItems([]); }
    );
  }, [nombre]);
  const guardar = useCallback((upd) => {
    const prev = ref.current;
    const next = typeof upd === "function" ? upd(prev) : upd;
    ref.current = next;
    setItems(next);
    const prevMap = new Map(prev.map(x => [String(x.id), x]));
    const nextIds = new Set(next.map(x => String(x.id)));
    const batch = writeBatch(db);
    let ops = 0;
    next.forEach(x => {
      const k = String(x.id);
      const nuevo = limpiar(x);
      const old = prevMap.get(k);
      if (!old || JSON.stringify(limpiar(old)) !== JSON.stringify(nuevo)) { batch.set(doc(db, nombre, k), nuevo); ops++; }
    });
    prev.forEach(x => { if (!nextIds.has(String(x.id))) { batch.delete(doc(db, nombre, String(x.id))); ops++; } });
    if (ops > 0) batch.commit().catch(err => { console.error(err); alert("No se pudo guardar en la nube: " + err.message); });
  }, [nombre]);
  return [items, guardar];
}

// ── CATÁLOGO ──────────────────────────────────────────────────────────────────
const SERVICIOS_CATALOGO = [
  {id:1,nombre:"Corte"},{id:2,nombre:"Brushing / Planchita"},{id:3,nombre:"Color / Tintura"},
  {id:4,nombre:"Keratina / Botox"},{id:5,nombre:"Alisado"},{id:6,nombre:"Manicuria"},
  {id:7,nombre:"Belleza de pies"},{id:8,nombre:"Decoloración / Mechas"},{id:9,nombre:"Lavado"},
  {id:10,nombre:"Baño de crema"},{id:11,nombre:"Ampollas"},
];
const PROFESIONALES = ["Mirta Fernández","Rossana Fernández","Ariela Fernández","Celeste Córdoba","Cristian Coronel"];
const MESES       = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DIAS_SEMANA = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

// ── UTILS ─────────────────────────────────────────────────────────────────────
const fmt       = (n) => `$${Number(n).toLocaleString("es-AR")}`;
const fmtSaldo  = (n) => `${n<0?"-":"+"}${fmt(Math.abs(n))}`;
const fmtFecha  = (s) => { if(!s) return "—"; const [y,m,d]=s.split("-"); return `${d}/${m}/${y}`; };
const hoyStr    = ()  => new Date().toISOString().split("T")[0];
const deudaCliente  = (c) => c.visitas.reduce((a,v)=>a+(v.total-v.pagado),0);
const ultimaVisita  = (c) => { if(!c.visitas.length) return null; return c.visitas.reduce((a,b)=>a.fecha>b.fecha?a:b); };

// ── BADGE ─────────────────────────────────────────────────────────────────────
const Badge = ({children,color="gold"}) => {
  const colors = {gold:"bg-amber-400/20 text-amber-300 border border-amber-400/30",red:"bg-red-400/20 text-red-300 border border-red-400/30",green:"bg-emerald-400/20 text-emerald-300 border border-emerald-400/30",blue:"bg-sky-400/20 text-sky-300 border border-sky-400/30",gray:"bg-zinc-600/40 text-zinc-400 border border-zinc-600/40",purple:"bg-purple-400/20 text-purple-300 border border-purple-400/30"};
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium tracking-wide ${colors[color]}`}>{children}</span>;
};
const METODO_INFO_MAP={efectivo:{label:"💵 Efectivo",color:"green"},tarjeta:{label:"💳 Tarjeta",color:"blue"},transferencia:{label:"🏦 Transferencia",color:"gold"},qr:{label:"📱 QR",color:"purple"}};
const MetodoBadge = ({metodo}) => {
  const m=METODO_INFO_MAP[metodo]||{label:metodo,color:"gray"};
  return <Badge color={m.color}>{m.label}</Badge>;
};
// Muestra uno o varios badges de método según v.pagos (pago dividido) o v.metodoPago (pago simple)
const MetodosBadges = ({visita}) => {
  const pagos = visita.pagos && visita.pagos.length ? visita.pagos : [{monto:visita.pagado, metodo:visita.metodoPago}];
  return <>{pagos.map((p,i)=><MetodoBadge key={i} metodo={p.metodo}/>)}</>;
};


// ── PAGINADOR ─────────────────────────────────────────────────────────────────
function Paginador({total,porPagina,pagina,onChange}) {
  const totalPags=Math.ceil(total/porPagina);
  if(totalPags<=1) return null;

  // Mostrar máximo 5 páginas centradas en la actual
  const rango=2;
  let inicio=Math.max(1,pagina-rango);
  let fin=Math.min(totalPags,pagina+rango);
  if(fin-inicio<4){
    if(inicio===1) fin=Math.min(totalPags,inicio+4);
    else inicio=Math.max(1,fin-4);
  }
  const pags=Array.from({length:fin-inicio+1},(_,i)=>inicio+i);

  const irA=(e)=>{
    const n=parseInt(e.target.value);
    if(n>=1&&n<=totalPags) onChange(n);
  };

  return (
    <div className="flex flex-col items-center gap-2 mt-4">
      <div className="flex items-center gap-1.5">
        {/* Primera página */}
        {inicio>1&&<>
          <button onClick={()=>onChange(1)} className="w-8 h-8 rounded-lg text-xs font-bold transition-all"
            style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"#71717a"}}>1</button>
          {inicio>2&&<span className="text-zinc-600 text-xs px-1">…</span>}
        </>}

        <button onClick={()=>onChange(pagina-1)} disabled={pagina===1}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-30"
          style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"#71717a"}}>←</button>

        {pags.map(p=>(
          <button key={p} onClick={()=>onChange(p)}
            className="w-8 h-8 rounded-lg text-xs font-bold transition-all"
            style={{background:pagina===p?"linear-gradient(135deg,#d4af37,#b8932a)":"rgba(255,255,255,0.04)",border:pagina===p?"none":"1px solid rgba(255,255,255,0.08)",color:pagina===p?"#1a1a2e":"#71717a"}}>
            {p}
          </button>
        ))}

        <button onClick={()=>onChange(pagina+1)} disabled={pagina===totalPags}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-30"
          style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"#71717a"}}>→</button>

        {/* Última página */}
        {fin<totalPags&&<>
          {fin<totalPags-1&&<span className="text-zinc-600 text-xs px-1">…</span>}
          <button onClick={()=>onChange(totalPags)} className="w-8 h-8 rounded-lg text-xs font-bold transition-all"
            style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"#71717a"}}>{totalPags}</button>
        </>}
      </div>

      {/* Ir a página específica — solo si hay muchas páginas */}
      {totalPags>5&&(
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-600">Ir a página</span>
          <input type="number" min={1} max={totalPags} defaultValue={pagina}
            key={pagina}
            onBlur={irA}
            onKeyDown={e=>e.key==="Enter"&&irA(e)}
            className="w-14 px-2 py-1 rounded-lg text-xs text-white text-center"
            style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
          <span className="text-xs text-zinc-600">de {totalPags}</span>
        </div>
      )}
    </div>
  );
}

// ── FORM VISITA ───────────────────────────────────────────────────────────────
function FormVisita({inicial,onSave,onClose,titulo}) {
  const inicialPagos = inicial?.pagos && inicial.pagos.length>1;
  const [fecha,setProfFecha]   = useState(inicial?.fecha??hoyStr());
  const [prof,setProf]         = useState(inicial?.profesional??PROFESIONALES[0]);
  const [svcs,setSvcs]         = useState(inicial?.servicios?.map(s=>({...s,precio:String(s.precio)}))??[]);
  const [pagado,setPagado]     = useState(inicial?.pagado!=null?String(inicial.pagado):"");
  const [metodo,setMetodo]     = useState(inicial?.metodoPago??"efectivo");
  const [nota,setNota]         = useState(inicial?.nota??"");
  // Pago dividido en 2 métodos
  const [dividirPago,setDividirPago] = useState(!!inicialPagos);
  const [pago1Monto,setPago1Monto]   = useState(inicialPagos?String(inicial.pagos[0].monto):"");
  const [pago1Metodo,setPago1Metodo] = useState(inicialPagos?inicial.pagos[0].metodo:"efectivo");
  const [pago2Monto,setPago2Monto]   = useState(inicialPagos?String(inicial.pagos[1].monto):"");
  const [pago2Metodo,setPago2Metodo] = useState(inicialPagos?inicial.pagos[1].metodo:"tarjeta");

  const total = svcs.reduce((a,s)=>a+(Number(s.precio)||0),0);
  const totalPagadoDividido = (Number(pago1Monto)||0) + (Number(pago2Monto)||0);
  const toggle = (svc) => setSvcs(p=>p.find(s=>s.id===svc.id)?p.filter(s=>s.id!==svc.id):[...p,{id:svc.id,nombre:svc.nombre,precio:""}]);
  const setP   = (id,v)=> setSvcs(p=>p.map(s=>s.id===id?{...s,precio:v}:s));

  const save = () => {
    if(!svcs.length) return alert("Seleccioná al menos un servicio");
    const sp=svcs.filter(s=>!s.precio||Number(s.precio)<=0);
    if(sp.length) return alert(`Falta precio de: ${sp.map(s=>s.nombre).join(", ")}`);

    let pagosFinales, pagadoFinal, metodoFinal;
    if(dividirPago) {
      const m1=Number(pago1Monto)||0, m2=Number(pago2Monto)||0;
      if(m1<=0 && m2<=0) return alert("Ingresá al menos un monto en los pagos divididos");
      pagosFinales = [];
      if(m1>0) pagosFinales.push({monto:m1, metodo:pago1Metodo});
      if(m2>0) pagosFinales.push({monto:m2, metodo:pago2Metodo});
      pagadoFinal = m1+m2;
      metodoFinal = pagosFinales.length>1 ? "mixto" : pagosFinales[0].metodo;
    } else {
      pagadoFinal = Number(pagado)||0;
      metodoFinal = metodo;
      pagosFinales = pagadoFinal>0 ? [{monto:pagadoFinal, metodo:metodoFinal}] : [];
    }

    onSave({...(inicial||{}),fecha,profesional:prof,servicios:svcs.map(s=>({...s,precio:Number(s.precio)})),total,pagado:pagadoFinal,metodoPago:metodoFinal,pagos:pagosFinales,nota,id:inicial?.id??Date.now()});
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.75)",backdropFilter:"blur(6px)"}}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl" style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.3)"}}>
        <div className="px-6 py-4 flex items-center justify-between" style={{background:"rgba(212,175,55,0.08)",borderBottom:"1px solid rgba(212,175,55,0.2)"}}>
          <p className="text-lg font-bold text-white">{titulo}</p>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Fecha</label>
              <input type="date" value={fecha} onChange={e=>setProfFecha(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
            </div>
            <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Profesional</label>
              <select value={prof} onChange={e=>setProf(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.25)"}}>
                {PROFESIONALES.map(p=><option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-2">Servicios</label>
            <div className="grid grid-cols-2 gap-1.5">
              {SERVICIOS_CATALOGO.map(svc=>{const sel=!!svcs.find(s=>s.id===svc.id);return(
                <button key={svc.id} onClick={()=>toggle(svc)} className="px-3 py-2 rounded-lg text-xs transition-all text-left"
                  style={{background:sel?"rgba(212,175,55,0.2)":"rgba(255,255,255,0.04)",border:sel?"1px solid rgba(212,175,55,0.6)":"1px solid rgba(255,255,255,0.08)",color:sel?"#f5c842":"#a1a1aa"}}>
                  {svc.nombre}
                </button>
              );})}
            </div>
          </div>
          {svcs.length>0&&(<div className="space-y-2">
            <label className="text-xs text-amber-400/70 uppercase tracking-widest block">Precio por servicio ($)</label>
            {svcs.map(s=>(
              <div key={s.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(212,175,55,0.2)"}}>
                <span className="flex-1 text-sm text-zinc-300">{s.nombre}</span>
                <span className="text-amber-400 text-sm font-bold">$</span>
                <input type="number" placeholder="0" value={s.precio} onChange={e=>setP(s.id,e.target.value)} className="w-28 px-2 py-1 rounded-lg text-sm text-white text-right" style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(212,175,55,0.35)"}}/>
              </div>
            ))}
            <div className="flex justify-between items-center px-3 py-2 rounded-lg font-bold" style={{background:"rgba(212,175,55,0.1)",border:"1px solid rgba(212,175,55,0.25)"}}>
              <span className="text-white">Total</span><span className="text-amber-400 text-lg">{fmt(total)}</span>
            </div>
          </div>)}
          {/* Toggle pago dividido */}
          <div className="flex items-center justify-between rounded-lg px-3 py-2" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)"}}>
            <span className="text-sm text-zinc-300">Dividir el pago en 2 métodos</span>
            <button onClick={()=>setDividirPago(d=>!d)}
              className="relative w-11 h-6 rounded-full transition-colors"
              style={{background:dividirPago?"#d4af37":"rgba(255,255,255,0.15)"}}>
              <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform" style={{transform:dividirPago?"translateX(20px)":"translateX(0)"}}/>
            </button>
          </div>

          {!dividirPago ? (
            <div className="grid grid-cols-2 gap-4">
              <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Pagado ($)</label>
                <input type="number" placeholder={total||"0"} value={pagado} onChange={e=>setPagado(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
              </div>
              <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Método de pago</label>
                <select value={metodo} onChange={e=>setMetodo(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.25)"}}>
                  <option value="efectivo">💵 Efectivo</option><option value="tarjeta">💳 Tarjeta</option>
                  <option value="transferencia">🏦 Transferencia</option><option value="qr">📱 QR</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Pago 1 */}
              <div className="rounded-lg p-3 space-y-2" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(212,175,55,0.2)"}}>
                <p className="text-xs text-amber-400/70 uppercase tracking-widest">Pago 1</p>
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" placeholder="Monto $" value={pago1Monto} onChange={e=>setPago1Monto(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
                  <select value={pago1Metodo} onChange={e=>setPago1Metodo(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.25)"}}>
                    <option value="efectivo">💵 Efectivo</option><option value="tarjeta">💳 Tarjeta</option>
                    <option value="transferencia">🏦 Transferencia</option><option value="qr">📱 QR</option>
                  </select>
                </div>
              </div>
              {/* Pago 2 */}
              <div className="rounded-lg p-3 space-y-2" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(212,175,55,0.2)"}}>
                <p className="text-xs text-amber-400/70 uppercase tracking-widest">Pago 2</p>
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" placeholder="Monto $" value={pago2Monto} onChange={e=>setPago2Monto(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
                  <select value={pago2Metodo} onChange={e=>setPago2Metodo(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.25)"}}>
                    <option value="efectivo">💵 Efectivo</option><option value="tarjeta">💳 Tarjeta</option>
                    <option value="transferencia">🏦 Transferencia</option><option value="qr">📱 QR</option>
                  </select>
                </div>
              </div>
              {/* Resumen */}
              <div className="flex justify-between items-center px-3 py-2 rounded-lg text-sm" style={{background:"rgba(212,175,55,0.08)",border:"1px solid rgba(212,175,55,0.2)"}}>
                <span className="text-zinc-400">Total pagado</span>
                <span className={`font-bold ${totalPagadoDividido<total?"text-amber-300":"text-emerald-400"}`}>{fmt(totalPagadoDividido)} {total>0&&`/ ${fmt(total)}`}</span>
              </div>
            </div>
          )}
          {/* Nota */}
          <div>
            <label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Nota (opcional)</label>
            <textarea value={nota} onChange={e=>setNota(e.target.value)} placeholder="Ej: se aplicó tratamiento extra, cabello muy dañado..." rows={2}
              className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-zinc-600 resize-none"
              style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
          </div>
        </div>
        <div className="px-6 py-4 flex gap-3" style={{borderTop:"1px solid rgba(212,175,55,0.15)"}}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm text-zinc-400" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>Cancelar</button>
          <button onClick={save} className="flex-1 py-2.5 rounded-xl text-sm font-bold" style={{background:"linear-gradient(135deg, #d4af37, #b8932a)",color:"#1a1a2e"}}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ── MODAL CLIENTE ─────────────────────────────────────────────────────────────
function ModalCliente({cliente,onClose,onSave,clientesExistentes=[]}) {
  const [form,setForm]=useState({nombre:cliente?.nombre??"",telefono:cliente?.telefono??"",email:cliente?.email??"",notas:cliente?.notas??""});
  const set=(k)=>(e)=>setForm(p=>({...p,[k]:e.target.value}));

  const handleGuardar = () => {
    const nombreLimpio = form.nombre.trim();
    if(!nombreLimpio) return alert("El nombre es obligatorio");
    const duplicado = clientesExistentes.find(c =>
      c.nombre.trim().toLowerCase() === nombreLimpio.toLowerCase() && c.id !== cliente?.id
    );
    if(duplicado) {
      const continuar = window.confirm(`Ya existe un cliente llamado "${duplicado.nombre}".\n\n¿Querés crear otro cliente con el mismo nombre igual?`);
      if(!continuar) return;
    }
    onSave({...(cliente||{}), ...form, nombre:nombreLimpio, id:cliente?.id??Date.now(), visitas:cliente?.visitas??[]});
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.75)",backdropFilter:"blur(6px)"}}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl" style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.3)"}}>
        <div className="px-6 py-4 flex items-center justify-between" style={{background:"rgba(212,175,55,0.08)",borderBottom:"1px solid rgba(212,175,55,0.2)"}}>
          <h3 className="text-lg font-bold text-white">{cliente?"Editar cliente":"Nuevo cliente"}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          {[["nombre","Nombre completo *","text"],["telefono","Teléfono","tel"],["email","Email","email"]].map(([k,lbl,type])=>(
            <div key={k}><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">{lbl}</label>
              <input type={type} value={form[k]} onChange={set(k)} placeholder={lbl} className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-zinc-600" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
            </div>
          ))}
          <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Notas</label>
            <textarea value={form.notas} onChange={set("notas")} placeholder="Alergias, preferencias..." rows={2} className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-zinc-600 resize-none" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
          </div>
        </div>
        <div className="px-6 py-4 flex gap-3" style={{borderTop:"1px solid rgba(212,175,55,0.15)"}}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm text-zinc-400" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>Cancelar</button>
          <button onClick={handleGuardar}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold" style={{background:"linear-gradient(135deg, #d4af37, #b8932a)",color:"#1a1a2e"}}>
            {cliente?"Guardar cambios":"Crear cliente"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── HISTORIAL VISITAS (agrupado por año/mes, colapsable) ─────────────────────
function HistorialVisitas({visitas,onEditarVisita,onEliminarVisita}) {
  // Agrupar por año-mes
  const grupos = useMemo(()=>{
    const map={};
    [...visitas].sort((a,b)=>b.fecha.localeCompare(a.fecha)).forEach(v=>{
      const [y,m]=v.fecha.split("-");
      const key=`${y}-${m}`;
      if(!map[key]) map[key]={key,anio:y,mes:parseInt(m)-1,visitas:[]};
      map[key].visitas.push(v);
    });
    return Object.values(map).sort((a,b)=>b.key.localeCompare(a.key));
  },[visitas]);

  // Por defecto el primer grupo (más reciente) abierto
  const [abiertos,setAbiertos]=useState(()=>grupos.length>0?new Set([grupos[0]?.key]):new Set());
  const toggle=(key)=>setAbiertos(prev=>{const n=new Set(prev);n.has(key)?n.delete(key):n.add(key);return n;});

  // Filtro por año
  const anios=[...new Set(grupos.map(g=>g.anio))].sort((a,b)=>b-a);
  const [anioFiltro,setAnioFiltro]=useState("todos");

  const gruposFiltrados=anioFiltro==="todos"?grupos:grupos.filter(g=>g.anio===anioFiltro);

  if(visitas.length===0) return <p className="text-sm text-zinc-600 text-center py-8">Sin visitas registradas</p>;

  return (
    <div className="space-y-3">
      {/* Header con filtro */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-widest text-amber-400/60">Historial de visitas</h3>
        <div className="flex items-center gap-2">
          {anios.length>1&&(
            <select value={anioFiltro} onChange={e=>setAnioFiltro(e.target.value)}
              className="text-xs px-2 py-1 rounded-lg text-zinc-300"
              style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.25)"}}>
              <option value="todos">Todos los años</option>
              {anios.map(a=><option key={a} value={a}>{a}</option>)}
            </select>
          )}
          <button onClick={()=>setAbiertos(new Set(gruposFiltrados.map(g=>g.key)))}
            className="text-xs px-2 py-1 rounded-lg text-zinc-500 hover:text-white transition-colors"
            style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}>
            Expandir todo
          </button>
          <button onClick={()=>setAbiertos(new Set())}
            className="text-xs px-2 py-1 rounded-lg text-zinc-500 hover:text-white transition-colors"
            style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}>
            Colapsar
          </button>
        </div>
      </div>

      {/* Grupos por mes */}
      {gruposFiltrados.map(g=>{
        const abierto=abiertos.has(g.key);
        const totalMes=g.visitas.reduce((a,v)=>a+v.total,0);
        const deudaMes=g.visitas.reduce((a,v)=>a+(v.total-v.pagado),0);
        return (
          <div key={g.key} className="rounded-xl overflow-hidden" style={{border:"1px solid rgba(255,255,255,0.07)"}}>
            {/* Cabecera del mes — siempre visible */}
            <button onClick={()=>toggle(g.key)} className="w-full px-4 py-3 flex items-center justify-between transition-all"
              style={{background:abierto?"rgba(212,175,55,0.1)":"rgba(255,255,255,0.03)"}}>
              <div className="flex items-center gap-3">
                <span className="text-lg">{abierto?"▾":"▸"}</span>
                <div className="text-left">
                  <p className="text-sm font-bold text-white">{MESES[g.mes]} {g.anio}</p>
                  <p className="text-xs text-zinc-500">{g.visitas.length} {g.visitas.length===1?"visita":"visitas"}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-amber-400">{fmt(totalMes)}</p>
                {deudaMes>0&&<p className="text-xs text-red-400">Debe {fmt(deudaMes)}</p>}
              </div>
            </button>

            {/* Visitas del mes */}
            {abierto&&(
              <div className="divide-y" style={{borderTop:"1px solid rgba(255,255,255,0.06)",divideColor:"rgba(255,255,255,0.04)"}}>
                {g.visitas.map(v=>{
                  const pendiente=v.total-v.pagado;
                  return (
                    <div key={v.id} className="px-4 py-3" style={{background:"rgba(255,255,255,0.02)"}}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <span className="text-sm font-semibold text-white">{fmtFecha(v.fecha)}</span>
                          <span className="text-xs text-zinc-500 ml-2">con {v.profesional}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          <MetodosBadges visita={v}/>
                          {pendiente>0&&<Badge color="red">Debe {fmt(pendiente)}</Badge>}
                          <button onClick={()=>onEditarVisita(v)} className="text-xs px-2 py-1 rounded-lg" style={{background:"rgba(212,175,55,0.15)",color:"#d4af37",border:"1px solid rgba(212,175,55,0.3)"}}>✏️</button>
                          <button onClick={()=>{if(window.confirm(`¿Eliminar visita del ${fmtFecha(v.fecha)}?`))onEliminarVisita(v.id);}} className="text-xs px-2 py-1 rounded-lg" style={{background:"rgba(239,68,68,0.15)",color:"#f87171",border:"1px solid rgba(239,68,68,0.3)"}}>🗑️</button>
                        </div>
                      </div>
                      <div className="space-y-0.5 mb-2">{v.servicios.map(s=>(
                        <div key={s.id} className="flex justify-between text-xs"><span className="text-zinc-500">{s.nombre}</span><span className="text-zinc-300">{fmt(s.precio)}</span></div>
                      ))}</div>
                      {v.nota&&<p className="text-xs text-amber-300/60 italic mt-1">📝 {v.nota}</p>}
                      <div className="flex justify-between pt-2" style={{borderTop:"1px solid rgba(255,255,255,0.05)"}}>
                        <span className="text-xs text-zinc-600">Pagado: <span className="text-emerald-400 font-medium">{fmt(v.pagado)}</span></span>
                        <span className="text-sm font-bold text-amber-400">Total: {fmt(v.total)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── DETALLE CLIENTE ───────────────────────────────────────────────────────────
function DetalleCliente({cliente,onBack,onEditarCliente,onEliminarCliente,onNuevaVisita,onEditarVisita,onEliminarVisita,onPagarDeuda}) {
  const [visitaEditando,setVisitaEditando]=useState(null);
  const deuda=deudaCliente(cliente);
  const totalGastado=cliente.visitas.reduce((a,v)=>a+v.total,0);
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <button onClick={onBack} className="mt-1 text-amber-400/60 hover:text-amber-400 text-lg">←</button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-2xl font-bold text-white">{cliente.nombre}</h2>
            <button onClick={onEditarCliente} className="text-xs px-2 py-1 rounded-lg" style={{background:"rgba(212,175,55,0.15)",color:"#d4af37",border:"1px solid rgba(212,175,55,0.3)"}}>✏️ Editar</button>
            <button onClick={onEliminarCliente} className="text-xs px-2 py-1 rounded-lg" style={{background:"rgba(239,68,68,0.15)",color:"#f87171",border:"1px solid rgba(239,68,68,0.3)"}}>🗑️ Eliminar</button>
          </div>
          <div className="flex flex-wrap gap-3 mt-1.5">
            {cliente.telefono&&<span className="text-sm text-zinc-400">📞 {cliente.telefono}</span>}
            {cliente.email&&<span className="text-sm text-zinc-400">✉️ {cliente.email}</span>}
          </div>
          {cliente.notas&&<p className="mt-1 text-xs text-amber-300/70 italic">⚠️ {cliente.notas}</p>}
        </div>
        <button onClick={onNuevaVisita} className="px-4 py-2 rounded-xl text-sm font-bold shrink-0" style={{background:"linear-gradient(135deg, #d4af37, #b8932a)",color:"#1a1a2e"}}>+ Visita</button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[{label:"Visitas",value:cliente.visitas.length,icon:"✂️"},{label:"Gastado",value:fmt(totalGastado),icon:"💰"},{label:"Deuda",value:fmt(deuda),icon:"⚡",red:deuda>0}].map(s=>(
          <div key={s.label} className="rounded-xl p-4 text-center" style={{background:s.red&&deuda>0?"rgba(239,68,68,0.1)":"rgba(212,175,55,0.07)",border:`1px solid ${s.red&&deuda>0?"rgba(239,68,68,0.3)":"rgba(212,175,55,0.15)"}`}}>
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className={`text-lg font-bold ${s.red&&deuda>0?"text-red-400":"text-amber-300"}`}>{s.value}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>
      {deuda>0&&(
        <div className="rounded-xl p-4 flex items-center justify-between" style={{background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)"}}>
          <div><p className="text-sm font-semibold text-red-400">Deuda: {fmt(deuda)}</p><p className="text-xs text-red-400/60 mt-0.5">Tiene pagos pendientes</p></div>
          <button onClick={()=>onPagarDeuda(deuda)} className="px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{background:"rgba(239,68,68,0.4)",border:"1px solid rgba(239,68,68,0.5)"}}>Registrar pago</button>
        </div>
      )}
      <HistorialVisitas
        visitas={cliente.visitas}
        onEditarVisita={setVisitaEditando}
        onEliminarVisita={onEliminarVisita}
      />
      {visitaEditando&&<FormVisita inicial={visitaEditando} titulo={`Editar visita — ${fmtFecha(visitaEditando.fecha)}`} onClose={()=>setVisitaEditando(null)} onSave={v=>{onEditarVisita(v);setVisitaEditando(null);}}/>}
    </div>
  );
}

// ── MODAL MOVIMIENTO CAJA ─────────────────────────────────────────────────────
function ModalMovimiento({onClose,onSave,movimiento}) {
  const [tipo,setTipo]=useState(movimiento?.tipo??"ingreso");const [concepto,setConcepto]=useState(movimiento?.concepto??"");const [monto,setMonto]=useState(movimiento?.monto?String(movimiento.monto):"");
  const [metodo,setMetodo]=useState(movimiento?.metodo??"efectivo");const [fecha,setFecha]=useState(movimiento?.fecha??hoyStr());const [categoria,setCategoria]=useState(movimiento?.categoria??"otro");
  const catE=["alquiler","luz/gas/agua","productos","sueldos","limpieza","otro"];
  const catI=["servicio","venta producto","otro"];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.75)",backdropFilter:"blur(6px)"}}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl" style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.3)"}}>
        <div className="px-6 py-4 flex items-center justify-between" style={{background:"rgba(212,175,55,0.08)",borderBottom:"1px solid rgba(212,175,55,0.2)"}}>
          <h3 className="text-lg font-bold text-white">{movimiento?"Editar movimiento":"Nuevo movimiento"}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {[["ingreso","💰 Ingreso"],["egreso","💸 Egreso"]].map(([v,lbl])=>(
              <button key={v} onClick={()=>{setTipo(v);setCategoria("otro");}} className="py-2.5 rounded-xl text-sm font-bold"
                style={{background:tipo===v?(v==="ingreso"?"rgba(52,211,153,0.2)":"rgba(239,68,68,0.2)"):"rgba(255,255,255,0.04)",border:tipo===v?(v==="ingreso"?"1px solid rgba(52,211,153,0.5)":"1px solid rgba(239,68,68,0.5)"):"1px solid rgba(255,255,255,0.08)",color:tipo===v?(v==="ingreso"?"#34d399":"#f87171"):"#71717a"}}>{lbl}</button>
            ))}
          </div>
          <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Fecha</label>
            <input type="date" value={fecha} onChange={e=>setFecha(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
          </div>
          <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Concepto</label>
            <input type="text" value={concepto} onChange={e=>setConcepto(e.target.value)} placeholder="Ej: Compra tinturas..." className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-zinc-600" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
          </div>
          <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Categoría</label>
            <select value={categoria} onChange={e=>setCategoria(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.25)"}}>
              {(tipo==="egreso"?catE:catI).map(c=><option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Monto ($)</label>
              <input type="number" value={monto} onChange={e=>setMonto(e.target.value)} placeholder="0" className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
            </div>
            <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Método</label>
              <select value={metodo} onChange={e=>setMetodo(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.25)"}}>
                <option value="efectivo">💵 Efectivo</option><option value="tarjeta">💳 Tarjeta</option>
                <option value="transferencia">🏦 Transferencia</option><option value="qr">📱 QR</option>
              </select>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 flex gap-3" style={{borderTop:"1px solid rgba(212,175,55,0.15)"}}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm text-zinc-400" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>Cancelar</button>
          <button onClick={()=>{if(!concepto.trim())return alert("Escribí un concepto");if(!monto||Number(monto)<=0)return alert("Ingresá un monto válido");onSave({id:movimiento?.id??Date.now(),tipo,concepto,monto:Number(monto),metodo,fecha,categoria});}}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold" style={{background:"linear-gradient(135deg, #d4af37, #b8932a)",color:"#1a1a2e"}}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ── VISTA CAJA ────────────────────────────────────────────────────────────────
function VistaCaja({clientes}) {
  const [movsNube,setMovs]=useColeccion("gestion_caja");
  const movs=useMemo(()=>movsNube||[],[movsNube]);
  const [modal,setModal]=useState(false);
  const [movEditando,setMovEditando]=useState(null);
  const [paginaCaja,setPaginaCaja]=useState(1);
  const POR_PAG_CAJA=10;
  const [desde,setDesde]=useState(()=>{const d=new Date();d.setDate(1);return d.toISOString().split("T")[0];});
  const [hasta,setHasta]=useState(hoyStr());
  const ingAuto=useMemo(()=>{
    const r=[];
    clientes.forEach(c=>c.visitas.forEach(v=>{
      const pagos = v.pagos && v.pagos.length ? v.pagos : (v.pagado>0 ? [{monto:v.pagado, metodo:v.metodoPago}] : []);
      pagos.forEach((p,idx)=>{
        if(p.monto>0) r.push({id:`v-${v.id}-${idx}`,tipo:"ingreso",concepto:`${c.nombre} — ${v.servicios.map(s=>s.nombre).join(", ")}`,monto:p.monto,metodo:p.metodo,fecha:v.fecha,categoria:"servicio",automatico:true});
      });
    }));
    return r;
  },[clientes]);
  const todos=useMemo(()=>[...ingAuto,...movs].filter(m=>m.fecha>=desde&&m.fecha<=hasta).sort((a,b)=>b.fecha.localeCompare(a.fecha)),[ingAuto,movs,desde,hasta]);
  const res=useMemo(()=>{const mt={efectivo:0,tarjeta:0,transferencia:0,qr:0};let ti=0,te=0;todos.forEach(m=>{if(m.tipo==="ingreso"){ti+=m.monto;if(mt[m.metodo]!==undefined)mt[m.metodo]+=m.monto;}else te+=m.monto;});return{mt,ti,te,neto:ti-te};},[todos]);
  const MI={efectivo:{label:"Efectivo",icon:"💵",color:"#34d399"},tarjeta:{label:"Tarjeta",icon:"💳",color:"#60a5fa"},transferencia:{label:"Transferencia",icon:"🏦",color:"#f59e0b"},qr:{label:"QR",icon:"📱",color:"#c084fc"}};
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-bold text-white">Caja</h2><p className="text-xs text-zinc-500 uppercase tracking-widest">Ingresos y egresos</p></div>
        <button onClick={()=>setModal(true)} className="px-4 py-2 rounded-xl text-sm font-bold" style={{background:"linear-gradient(135deg, #d4af37, #b8932a)",color:"#1a1a2e"}}>+ Movimiento</button>
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-xl p-4" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
        {[["Desde",desde,(v)=>{setDesde(v);setPaginaCaja(1);}],["Hasta",hasta,(v)=>{setHasta(v);setPaginaCaja(1);}]].map(([lbl,val,fn])=>(
          <div key={lbl}><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">{lbl}</label>
            <input type="date" value={val} onChange={e=>fn(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[{label:"Ingresos",v:res.ti,c:"#34d399",i:"📈"},{label:"Egresos",v:res.te,c:"#f87171",i:"📉"},{label:"Neto",v:res.neto,c:res.neto>=0?"#34d399":"#f87171",i:"💼"}].map(s=>(
          <div key={s.label} className="rounded-xl p-3 text-center" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
            <div className="text-xl mb-1">{s.i}</div><div className="text-sm font-bold" style={{color:s.c}}>{fmt(s.v)}</div><div className="text-xs text-zinc-500">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="rounded-xl p-4 space-y-3" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
        <p className="text-xs uppercase tracking-widest text-amber-400/60">Ingresos por método</p>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(res.mt).map(([k,v])=>(
            <div key={k} className="flex items-center justify-between rounded-lg px-3 py-2" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
              <span className="text-sm text-zinc-400">{MI[k].icon} {MI[k].label}</span>
              <span className="text-sm font-bold" style={{color:MI[k].color}}>{fmt(v)}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs uppercase tracking-widest text-amber-400/60 mb-3">Movimientos ({todos.length})</p>
        {todos.length===0?<p className="text-sm text-zinc-600 text-center py-8">Sin movimientos en este período</p>:(
          <>
          <div className="space-y-2">
            {todos.slice((paginaCaja-1)*POR_PAG_CAJA,paginaCaja*POR_PAG_CAJA).map(m=>(
              <div key={m.id} className="rounded-xl px-4 py-3" style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${m.tipo==="ingreso"?"rgba(52,211,153,0.1)":"rgba(239,68,68,0.1)"}`}}>
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><span className="text-sm font-medium text-white truncate">{m.concepto}</span>{m.automatico&&<span className="text-xs text-zinc-600 italic">auto</span>}</div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-zinc-500">{fmtFecha(m.fecha)}</span>
                      <span className="text-xs" style={{color:MI[m.metodo]?.color||"#888"}}>{MI[m.metodo]?.icon} {MI[m.metodo]?.label}</span>
                      <span className="text-xs text-zinc-600">{m.categoria}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <span className="font-bold text-sm" style={{color:m.tipo==="ingreso"?"#34d399":"#f87171"}}>{m.tipo==="ingreso"?"+":"-"}{fmt(m.monto)}</span>
                    {!m.automatico&&<button onClick={()=>setMovEditando(m)} className="text-xs px-2 py-1 rounded-lg" style={{background:"rgba(212,175,55,0.15)",color:"#d4af37",border:"1px solid rgba(212,175,55,0.3)"}}>✏️</button>}
                    <button onClick={()=>{if(window.confirm("¿Eliminar este movimiento?"))setMovs(p=>p.filter(x=>x.id!==m.id));}} className="text-xs px-2 py-1 rounded-lg" style={{background:"rgba(239,68,68,0.15)",color:"#f87171",border:"1px solid rgba(239,68,68,0.3)"}}>🗑️</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Paginador total={todos.length} porPagina={POR_PAG_CAJA} pagina={paginaCaja} onChange={setPaginaCaja}/>
          </>
        )}
      </div>
      {modal&&<ModalMovimiento onClose={()=>setModal(false)} onSave={m=>{setMovs(p=>[m,...p]);setPaginaCaja(1);setModal(false);}}/>}
      {movEditando&&<ModalMovimiento movimiento={movEditando} onClose={()=>setMovEditando(null)} onSave={m=>{setMovs(p=>p.map(x=>x.id===m.id?m:x));setMovEditando(null);}}/>}

      {/* ── GUARDADO DE EFECTIVO ── */}
      <SeccionEfectivoDia/>
    </div>
  );
}

// ── SECCIÓN EFECTIVO DEL DÍA ──────────────────────────────────────────────────
function SeccionEfectivoDia() {
  const [registrosNube,setRegistros] = useColeccion("gestion_efectivo");
  const registros = useMemo(()=>(registrosNube||[]).filter(r=>r&&typeof r.monto==="number"&&!isNaN(r.monto)),[registrosNube]);
  const [fecha,setFecha]     = useState(hoyStr());
  const [monto,setMonto]     = useState("");
  const [nota,setNota]       = useState("");
  const [editando,setEditando] = useState(null); // id del registro editando
  const [expanded,setExpanded] = useState(true);


  const limpiarForm = () => { setMonto(""); setNota(""); setFecha(hoyStr()); setEditando(null); };

  const guardar = () => {
    const m = Number(monto);
    if(!monto || isNaN(m) || m<=0) return alert("Ingresá un monto válido");
    if(editando) {
      setRegistros(p=>p.map(r=>r.id===editando ? {...r,fecha,monto:m,nota} : r));
    } else {
      setRegistros(p=>[{id:Date.now(),fecha,monto:m,nota}, ...p]);
    }
    limpiarForm();
  };

  const iniciarEdicion = (r) => {
    setEditando(r.id);
    setFecha(r.fecha);
    setMonto(String(r.monto));
    setNota(r.nota||"");
  };

  const eliminar = (id) => {
    if(window.confirm("¿Eliminar este registro?")) setRegistros(p=>p.filter(r=>r.id!==id));
  };

  const totalAcumulado = registros.reduce((a,r)=>a+(Number(r.monto)||0), 0);

  // Agrupar por fecha
  const porFecha = useMemo(()=>{
    const map = {};
    registros.forEach(r=>{
      if(!r||!r.fecha) return;
      if(!map[r.fecha]) map[r.fecha] = {fecha:r.fecha, total:0, registros:[]};
      map[r.fecha].total += Number(r.monto)||0;
      map[r.fecha].registros.push(r);
    });
    return Object.values(map).sort((a,b)=>b.fecha.localeCompare(a.fecha));
  },[registros]);

  return (
    <div className="rounded-xl overflow-hidden mt-2" style={{border:"1px solid rgba(212,175,55,0.2)"}}>
      {/* Header colapsable */}
      <button onClick={()=>setExpanded(e=>!e)} className="w-full px-4 py-3 flex items-center justify-between"
        style={{background:"rgba(212,175,55,0.08)"}}>
        <div className="flex items-center gap-2">
          <span className="text-lg">💵</span>
          <div className="text-left">
            <p className="text-sm font-bold text-white">Guardado de efectivo</p>
            <p className="text-xs text-zinc-500">
              Total acumulado: <span className="text-amber-400 font-semibold">{fmt(totalAcumulado)}</span>
              <span className="text-zinc-600 ml-2">({porFecha.length} día{porFecha.length!==1?"s":""})</span>
            </p>
          </div>
        </div>
        <span className="text-zinc-500 text-lg">{expanded?"▾":"▸"}</span>
      </button>

      {expanded&&(
        <div className="p-4 space-y-4" style={{background:"rgba(255,255,255,0.02)"}}>

          {/* Formulario */}
          <div className="rounded-xl p-4 space-y-3" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(212,175,55,0.18)"}}>
            <p className="text-xs text-amber-400/70 uppercase tracking-widest">
              {editando ? "✏️ Editando registro" : "Registrar efectivo"}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Fecha</label>
                <input type="date" value={fecha} onChange={e=>setFecha(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm text-white"
                  style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Monto ($)</label>
                <input type="number" value={monto} onChange={e=>setMonto(e.target.value)}
                  placeholder="0" className="w-full px-3 py-2 rounded-lg text-sm text-white"
                  style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Nota (opcional)</label>
              <input type="text" value={nota} onChange={e=>setNota(e.target.value)}
                placeholder="Ej: caja del lunes, propinas..."
                className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-zinc-600"
                style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
            </div>
            <div className="flex gap-2">
              {editando&&(
                <button onClick={limpiarForm} className="px-4 py-2 rounded-xl text-sm text-zinc-400"
                  style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>
                  Cancelar
                </button>
              )}
              <button onClick={guardar} className="flex-1 py-2 rounded-xl text-sm font-bold"
                style={{background:"linear-gradient(135deg,#d4af37,#b8932a)",color:"#1a1a2e"}}>
                {editando ? "Guardar cambios" : "+ Guardar efectivo"}
              </button>
            </div>
          </div>

          {/* Historial agrupado por día */}
          {porFecha.length===0
            ? <p className="text-sm text-zinc-600 text-center py-6">Sin registros aún</p>
            : <div className="space-y-2">
                {porFecha.map(d=>(
                  <div key={d.fecha} className="rounded-xl overflow-hidden" style={{border:"1px solid rgba(255,255,255,0.06)"}}>
                    {/* Encabezado del día */}
                    <div className="flex items-center justify-between px-3 py-2.5"
                      style={{background:"rgba(255,255,255,0.04)"}}>
                      <span className="text-sm font-bold text-white">{fmtFecha(d.fecha)}</span>
                      <span className="text-sm font-bold text-amber-400">{fmt(d.total)}</span>
                    </div>
                    {/* Registros del día */}
                    {d.registros.map(r=>(
                      <div key={r.id} className="flex items-center justify-between px-3 py-2"
                        style={{borderTop:"1px solid rgba(255,255,255,0.04)"}}>
                        <span className="text-xs text-zinc-400 flex-1">{r.nota||"—"}</span>
                        <div className="flex items-center gap-2 ml-2 shrink-0">
                          <span className="text-sm font-semibold text-emerald-400">{fmt(Number(r.monto)||0)}</span>
                          <button onClick={()=>iniciarEdicion(r)}
                            className="text-xs px-2 py-0.5 rounded-lg"
                            style={{background:"rgba(212,175,55,0.15)",color:"#d4af37",border:"1px solid rgba(212,175,55,0.3)"}}>✏️</button>
                          <button onClick={()=>eliminar(r.id)}
                            className="text-xs px-2 py-0.5 rounded-lg"
                            style={{background:"rgba(239,68,68,0.15)",color:"#f87171",border:"1px solid rgba(239,68,68,0.3)"}}>🗑️</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
          }
        </div>
      )}
    </div>
  );
}

// ── VISTA CALENDARIO ──────────────────────────────────────────────────────────
function VistaCalendario({clientes}) {
  const hoy=new Date();
  const [anio,setAnio]=useState(hoy.getFullYear());
  const [mes,setMes]=useState(hoy.getMonth());
  const [diaS,setDiaS]=useState(null);
  const mapa=useMemo(()=>{const m={};clientes.forEach(c=>c.visitas.forEach(v=>{if(!m[v.fecha])m[v.fecha]={visitas:[],total:0,cantidad:0};m[v.fecha].visitas.push({...v,clienteNombre:c.nombre});m[v.fecha].total+=v.pagado;m[v.fecha].cantidad+=1;}));return m;},[clientes]);
  const diasMes=useMemo(()=>{const p=new Date(anio,mes,1);const u=new Date(anio,mes+1,0);const d=[];for(let i=0;i<p.getDay();i++)d.push(null);for(let i=1;i<=u.getDate();i++)d.push(i);return d;},[anio,mes]);
  const diasAct=useMemo(()=>{const pref=`${anio}-${String(mes+1).padStart(2,"0")}`;return Object.entries(mapa).filter(([f])=>f.startsWith(pref)).sort(([a],[b])=>b.localeCompare(a));},[mapa,anio,mes]);
  const prev=()=>{if(mes===0){setMes(11);setAnio(a=>a-1);}else setMes(m=>m-1);setDiaS(null);};
  const next=()=>{if(mes===11){setMes(0);setAnio(a=>a+1);}else setMes(m=>m+1);setDiaS(null);};
  const key=(d)=>`${anio}-${String(mes+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  const diaData=diaS?mapa[key(diaS)]:null;
  const totalMes=diasAct.reduce((a,[,d])=>a+d.total,0);
  const clientesMes=diasAct.reduce((a,[,d])=>a+d.cantidad,0);
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={prev} className="px-3 py-2 rounded-xl text-zinc-400 hover:text-white" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}>←</button>
        <div className="text-center"><h2 className="text-lg font-bold text-white">{MESES[mes]} {anio}</h2><p className="text-xs text-zinc-500">{clientesMes} clientes · {fmt(totalMes)}</p></div>
        <button onClick={next} className="px-3 py-2 rounded-xl text-zinc-400 hover:text-white" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}>→</button>
      </div>
      <div className="rounded-xl p-4" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
        <div className="grid grid-cols-7 mb-2">{DIAS_SEMANA.map(d=><div key={d} className="text-center text-xs text-zinc-600 font-medium py-1">{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-1">
          {diasMes.map((d,i)=>{if(!d)return <div key={`e-${i}`}/>;const k=key(d);const data=mapa[k];const esHoy=k===hoy.toISOString().split("T")[0];const sel=diaS===d;
            return(<button key={k} onClick={()=>setDiaS(sel?null:d)} className="flex flex-col items-center justify-center rounded-lg py-2 transition-all"
              style={{background:sel?"rgba(212,175,55,0.25)":data?"rgba(212,175,55,0.08)":"transparent",border:sel?"1px solid rgba(212,175,55,0.6)":esHoy?"1px solid rgba(212,175,55,0.35)":"1px solid transparent",minHeight:"44px"}}>
              <span className={`text-sm font-medium ${esHoy?"text-amber-400":data?"text-white":"text-zinc-600"}`}>{d}</span>
              {data&&<div className="flex gap-0.5 mt-0.5">{Array.from({length:Math.min(data.cantidad,4)}).map((_,i)=><div key={i} className="w-1 h-1 rounded-full" style={{background:"#d4af37"}}/>)}</div>}
            </button>);
          })}
        </div>
      </div>
      {diaS&&(
        <div className="rounded-xl p-4 space-y-3" style={{background:"rgba(212,175,55,0.06)",border:"1px solid rgba(212,175,55,0.2)"}}>
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-white">{fmtFecha(key(diaS))}</h3>
            <div className="flex gap-2"><Badge color="gold">{diaData?diaData.cantidad:0} clientes</Badge><Badge color="green">{fmt(diaData?diaData.total:0)}</Badge></div>
          </div>
          {!diaData?<p className="text-sm text-zinc-600">Sin actividad este día</p>:(
            <div className="space-y-2">{diaData.visitas.map(v=>(
              <div key={v.id} className="rounded-lg px-3 py-2.5" style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)"}}>
                <div className="flex items-center justify-between mb-1"><span className="text-sm font-semibold text-white">{v.clienteNombre}</span><span className="text-sm font-bold text-amber-400">{fmt(v.pagado)}</span></div>
                <div className="flex items-center justify-between flex-wrap gap-1"><span className="text-xs text-zinc-500">{v.profesional} · {v.servicios.map(s=>s.nombre).join(", ")}</span><div className="flex gap-1"><MetodosBadges visita={v}/></div></div>
              </div>
            ))}</div>
          )}
        </div>
      )}
      <div>
        <p className="text-xs uppercase tracking-widest text-amber-400/60 mb-3">Días con actividad</p>
        {diasAct.length===0?<p className="text-sm text-zinc-600 text-center py-8">Sin actividad este mes</p>:(
          <div className="space-y-2">{diasAct.map(([fecha,data])=>{const dNum=parseInt(fecha.split("-")[2]);const sel=diaS===dNum;
            return(<button key={fecha} onClick={()=>setDiaS(sel?null:dNum)} className="w-full rounded-xl px-4 py-3 transition-all text-left"
              style={{background:sel?"rgba(212,175,55,0.1)":"rgba(255,255,255,0.03)",border:sel?"1px solid rgba(212,175,55,0.3)":"1px solid rgba(255,255,255,0.06)"}}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-center rounded-lg px-2 py-1 min-w-[44px]" style={{background:"rgba(212,175,55,0.1)",border:"1px solid rgba(212,175,55,0.2)"}}>
                    <div className="text-xs text-amber-400/60">{MESES[parseInt(fecha.split("-")[1])-1].slice(0,3)}</div>
                    <div className="text-lg font-bold text-amber-400 leading-none">{fecha.split("-")[2]}</div>
                  </div>
                  <div><p className="text-sm font-medium text-white">{data.cantidad} {data.cantidad===1?"cliente":"clientes"}</p><p className="text-xs text-zinc-500 truncate max-w-[180px]">{data.visitas.map(v=>v.clienteNombre).join(", ")}</p></div>
                </div>
                <div className="text-right shrink-0"><p className="text-sm font-bold text-amber-400">{fmt(data.total)}</p><p className="text-xs text-zinc-600">facturado</p></div>
              </div>
            </button>);
          })}</div>
        )}
      </div>
    </div>
  );
}

// ── VISTA PROFESIONALES / VALES ───────────────────────────────────────────────
function VistaProfesionales() {
  const hoy=new Date();
  const mesActual=`${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,"0")}`;
  const [valesNube,setVales]=useColeccion("gestion_vales");
  const vales=useMemo(()=>valesNube||[],[valesNube]);
  const [modal,setModal]=useState(false);
  const [profSel,setProfSel]=useState(PROFESIONALES[0]);
  const [filtroProf,setFiltroProf]=useState("todos");
  const [filtroMesVales,setFiltroMesVales]=useState(mesActual);
  const [paginaVales,setPaginaVales]=useState(1);
  const POR_PAG_VALES=10;

  const mesesVales=useMemo(()=>{
    const set=new Set(vales.map(v=>v.fecha.slice(0,7)));
    set.add(mesActual);
    return [...set].sort((a,b)=>b.localeCompare(a));
  },[vales,mesActual]);

  const totalesPorProf=useMemo(()=>{
    const t={};
    PROFESIONALES.forEach(p=>{
      const pvales=vales.filter(v=>v.profesional===p&&(filtroMesVales===""||v.fecha.startsWith(filtroMesVales)));
      t[p]={total:pvales.reduce((a,v)=>a+v.monto,0),cantidad:pvales.length};
    });
    return t;
  },[vales,filtroMesVales]);

  const valesFiltrados=useMemo(()=>{
    let r=vales;
    if(filtroProf!=="todos") r=r.filter(v=>v.profesional===filtroProf);
    if(filtroMesVales) r=r.filter(v=>v.fecha.startsWith(filtroMesVales));
    return r.sort((a,b)=>b.fecha.localeCompare(a.fecha));
  },[vales,filtroProf,filtroMesVales]);

  const valesPaginados=valesFiltrados.slice((paginaVales-1)*POR_PAG_VALES, paginaVales*POR_PAG_VALES);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-bold text-white">Profesionales</h2><p className="text-xs text-zinc-500 uppercase tracking-widest">Vales / Anticipos</p></div>
        <button onClick={()=>setModal(true)} className="px-4 py-2 rounded-xl text-sm font-bold" style={{background:"linear-gradient(135deg, #d4af37, #b8932a)",color:"#1a1a2e"}}>+ Vale</button>
      </div>

      {/* Filtro por mes */}
      <div className="rounded-xl p-3 space-y-2" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
        <p className="text-xs text-amber-400/60 uppercase tracking-widest">Filtrar por mes</p>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={()=>{setFiltroMesVales("");setPaginaVales(1);}}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{background:filtroMesVales===""?"rgba(212,175,55,0.2)":"rgba(255,255,255,0.04)",border:filtroMesVales===""?"1px solid rgba(212,175,55,0.5)":"1px solid rgba(255,255,255,0.08)",color:filtroMesVales===""?"#d4af37":"#71717a"}}>
            Todos
          </button>
          {mesesVales.map(m=>{
            const [y,mo]=m.split("-");
            const lbl=`${MESES[parseInt(mo)-1].slice(0,3)} ${y}`;
            return(
              <button key={m} onClick={()=>{setFiltroMesVales(m);setPaginaVales(1);setFiltroProf("todos");}}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{background:filtroMesVales===m?"rgba(212,175,55,0.2)":"rgba(255,255,255,0.04)",border:filtroMesVales===m?"1px solid rgba(212,175,55,0.5)":"1px solid rgba(255,255,255,0.08)",color:filtroMesVales===m?"#d4af37":"#71717a"}}>
                {lbl}{m===mesActual?" (actual)":""}
              </button>
            );
          })}
        </div>
      </div>

      {/* Resumen por profesional */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-amber-400/60">Anticipos {filtroMesVales?`— ${MESES[parseInt(filtroMesVales.split("-")[1])-1]} ${filtroMesVales.split("-")[0]}`:"acumulados"}</p>
        {PROFESIONALES.map(p=>(
          <button key={p} onClick={()=>setFiltroProf(filtroProf===p?"todos":p)}
            className="w-full rounded-xl px-4 py-3 flex items-center justify-between transition-all"
            style={{background:filtroProf===p?"rgba(212,175,55,0.1)":"rgba(255,255,255,0.03)",border:filtroProf===p?"1px solid rgba(212,175,55,0.3)":"1px solid rgba(255,255,255,0.06)"}}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-lg font-bold" style={{background:"rgba(212,175,55,0.15)",color:"#d4af37"}}>
                {p.charAt(0)}
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-white">{p}</p>
                <p className="text-xs text-zinc-500">{totalesPorProf[p].cantidad} vale{totalesPorProf[p].cantidad!==1?"s":""}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold" style={{color:totalesPorProf[p].total>0?"#f87171":"#71717a"}}>{fmt(totalesPorProf[p].total)}</p>
              <p className="text-xs text-zinc-600">anticipado</p>
            </div>
          </button>
        ))}
      </div>

      {/* Lista de vales */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs uppercase tracking-widest text-amber-400/60">
            {filtroProf==="todos"?"Todos los vales":`Vales de ${filtroProf.split(" ")[0]}`}
          </p>
          {filtroProf!=="todos"&&<button onClick={()=>setFiltroProf("todos")} className="text-xs text-zinc-500 hover:text-white">Ver todos</button>}
        </div>
        {valesFiltrados.length===0?<p className="text-sm text-zinc-600 text-center py-8">Sin vales registrados</p>:(
          <>
          <div className="space-y-2">
            {valesPaginados.map(v=>(
              <div key={v.id} className="rounded-xl px-4 py-3 flex items-center justify-between" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(239,68,68,0.15)"}}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{v.profesional.split(" ")[0]} {v.profesional.split(" ")[1]}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-zinc-500">{fmtFecha(v.fecha)}</span>
                    <MetodoBadge metodo={v.metodo}/>
                    {v.nota&&<span className="text-xs text-zinc-600 italic">{v.nota}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <span className="font-bold text-sm text-red-400">-{fmt(v.monto)}</span>
                  <button onClick={()=>{if(window.confirm("¿Eliminar este vale?"))setVales(p=>p.filter(x=>x.id!==v.id));}} className="text-zinc-600 hover:text-red-400 text-lg leading-none">×</button>
                </div>
              </div>
            ))}
          </div>
          <Paginador total={valesFiltrados.length} porPagina={POR_PAG_VALES} pagina={paginaVales} onChange={setPaginaVales}/>
          </>
        )}
      </div>

      {/* Modal nuevo vale */}
      {modal&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.75)",backdropFilter:"blur(6px)"}}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl" style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.3)"}}>
            <NuevoValeForm profInicial={profSel} onClose={()=>setModal(false)} onSave={v=>{setVales(p=>[v,...p]);setModal(false);}}/>
          </div>
        </div>
      )}
    </div>
  );
}

function NuevoValeForm({profInicial,onClose,onSave}) {
  const [prof,setProf]=useState(profInicial);
  const [monto,setMonto]=useState("");
  const [metodo,setMetodo]=useState("efectivo");
  const [fecha,setFecha]=useState(hoyStr());
  const [nota,setNota]=useState("");
  return (
    <>
      <div className="px-6 py-4 flex items-center justify-between" style={{background:"rgba(212,175,55,0.08)",borderBottom:"1px solid rgba(212,175,55,0.2)"}}>
        <h3 className="text-lg font-bold text-white">Nuevo vale / anticipo</h3>
        <button onClick={onClose} className="text-zinc-500 hover:text-white text-2xl leading-none">×</button>
      </div>
      <div className="p-6 space-y-4">
        <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Profesional</label>
          <select value={prof} onChange={e=>setProf(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.25)"}}>
            {PROFESIONALES.map(p=><option key={p}>{p}</option>)}
          </select>
        </div>
        <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Fecha</label>
          <input type="date" value={fecha} onChange={e=>setFecha(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Monto ($)</label>
            <input type="number" value={monto} onChange={e=>setMonto(e.target.value)} placeholder="0" className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
          </div>
          <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Método</label>
            <select value={metodo} onChange={e=>setMetodo(e.target.value)} className="w-full px-3 py-2 rounded-lg text-sm text-white" style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.25)"}}>
              <option value="efectivo">💵 Efectivo</option>
              <option value="transferencia">🏦 Transferencia</option>
            </select>
          </div>
        </div>
        <div><label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Nota (opcional)</label>
          <input type="text" value={nota} onChange={e=>setNota(e.target.value)} placeholder="Ej: anticipo quincena..." className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-zinc-600" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
        </div>
      </div>
      <div className="px-6 py-4 flex gap-3" style={{borderTop:"1px solid rgba(212,175,55,0.15)"}}>
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm text-zinc-400" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>Cancelar</button>
        <button onClick={()=>{if(!monto||Number(monto)<=0)return alert("Ingresá un monto válido");onSave({id:Date.now(),profesional:prof,monto:Number(monto),metodo,fecha,nota});}}
          className="flex-1 py-2.5 rounded-xl text-sm font-bold" style={{background:"linear-gradient(135deg, #d4af37, #b8932a)",color:"#1a1a2e"}}>Guardar vale</button>
      </div>
    </>
  );
}

// ── MODAL RESTAURAR ───────────────────────────────────────────────────────────
function ModalRestaurar({onClose,onConfirm}) {
  const [paso,setPaso]=useState(1);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.85)",backdropFilter:"blur(6px)"}}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl" style={{background:"#1a1a2e",border:"1px solid rgba(239,68,68,0.4)"}}>
        <div className="px-6 py-4" style={{background:"rgba(239,68,68,0.1)",borderBottom:"1px solid rgba(239,68,68,0.2)"}}>
          <h3 className="text-lg font-bold text-red-400">⚠️ Restaurar sistema</h3>
        </div>
        <div className="p-6">
          {paso===1?(
            <>
              <p className="text-white font-semibold mb-2">¿Estás seguro que querés borrar todo?</p>
              <p className="text-sm text-zinc-400 mb-1">Esto eliminará <span className="text-red-400 font-semibold">permanentemente</span>:</p>
              <ul className="text-sm text-zinc-400 space-y-1 mb-6 ml-3">
                <li>• Todos los clientes y su historial de visitas</li>
                <li>• Todos los movimientos de caja</li>
                <li>• Todos los vales de profesionales</li>
                <li>• Proveedores y efectivo guardado</li>
                <li className="text-red-400">• Los datos están en la nube: se borran para TODAS las compañeras</li>
              </ul>
              <p className="text-xs text-zinc-600">Esta acción no se puede deshacer.</p>
            </>
          ):(
            <>
              <p className="text-white font-semibold mb-2">Confirmación final</p>
              <p className="text-sm text-zinc-400 mb-6">Escribí <span className="text-red-400 font-bold">BORRAR</span> para confirmar que entendés que se perderán todos los datos.</p>
              <ConfirmInput onConfirm={onConfirm} onCancel={()=>setPaso(1)}/>
            </>
          )}
        </div>
        {paso===1&&(
          <div className="px-6 py-4 flex gap-3" style={{borderTop:"1px solid rgba(239,68,68,0.2)"}}>
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm text-zinc-400" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>Cancelar</button>
            <button onClick={()=>setPaso(2)} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white" style={{background:"rgba(239,68,68,0.5)",border:"1px solid rgba(239,68,68,0.6)"}}>Continuar →</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmInput({onConfirm,onCancel}) {
  const [val,setVal]=useState("");
  return (
    <div className="space-y-3">
      <input type="text" value={val} onChange={e=>setVal(e.target.value)} placeholder="Escribí BORRAR" className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-zinc-600" style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(239,68,68,0.3)"}}/>
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm text-zinc-400" style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>← Volver</button>
        <button onClick={()=>{if(val==="BORRAR")onConfirm();else alert("Escribí exactamente BORRAR para confirmar");}}
          className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
          style={{background:val==="BORRAR"?"rgba(239,68,68,0.7)":"rgba(239,68,68,0.2)",border:"1px solid rgba(239,68,68,0.4)"}}>
          Borrar todo
        </button>
      </div>
    </div>
  );
}


// ── VISTA PROVEEDORES ─────────────────────────────────────────────────────────
function VistaProveedores() {
  const [proveedoresNube,setProvs] = useColeccion("gestion_proveedores");
  const proveedores = useMemo(()=>proveedoresNube||[],[proveedoresNube]);
  const [provSel,setProvSel]      = useState(null);
  const [modalProv,setModalProv]  = useState(false);   // nuevo proveedor
  const [modalMov,setModalMov]    = useState(false);    // nuevo movimiento
  const [paginaMov,setPaginaMov]  = useState(1);
  const POR_PAG_MOV = 10;


  const provActual = provSel ? proveedores.find(p=>p.id===provSel) : null;

  // Saldo = suma(haber) - suma(debe)   [haber = lo que pagamos, debe = lo que debemos]
  const saldo = (mov=[]) => mov.reduce((a,m)=>a+(m.haber||0)-(m.debe||0), 0);

  const agregarProveedor = (nombre) => {
    if(!nombre.trim()) return;
    if(proveedores.find(p=>p.nombre.toLowerCase()===nombre.toLowerCase()))
      return alert("Ya existe un proveedor con ese nombre");
    setProvs(p=>[...p,{id:Date.now(),nombre:nombre.trim(),movimientos:[]}]);
    setModalProv(false);
  };

  const agregarMovimiento = (mov) => {
    setProvs(p=>p.map(pr=>pr.id===provSel?{...pr,movimientos:[...pr.movimientos,{...mov,id:Date.now()}]}:pr));
    setModalMov(false);
  };

  const eliminarMovimiento = (movId) => {
    if(!window.confirm("¿Eliminar este movimiento?")) return;
    setProvs(p=>p.map(pr=>pr.id===provSel?{...pr,movimientos:pr.movimientos.filter(m=>m.id!==movId)}:pr));
  };

  const eliminarProveedor = () => {
    if(!window.confirm(`¿Eliminar proveedor "${provActual.nombre}" y todos sus movimientos?`)) return;
    setProvs(p=>p.filter(pr=>pr.id!==provSel));
    setProvSel(null);
  };

  const movsPaginados = provActual
    ? [...provActual.movimientos].sort((a,b)=>b.fecha.localeCompare(a.fecha))
        .slice((paginaMov-1)*POR_PAG_MOV, paginaMov*POR_PAG_MOV)
    : [];

  // ── LISTA DE PROVEEDORES ──
  if(!provActual) return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h2 className="text-xl font-bold text-white">Proveedores</h2>
          <p className="text-xs text-zinc-500 uppercase tracking-widest">Cuenta corriente</p>
        </div>
        <button onClick={()=>setModalProv(true)} className="px-4 py-2 rounded-xl text-sm font-bold"
          style={{background:"linear-gradient(135deg,#d4af37,#b8932a)",color:"#1a1a2e"}}>+ Proveedor</button>
      </div>

      {proveedores.length===0
        ? <div className="text-center py-16 space-y-2">
            <p className="text-4xl">🏪</p>
            <p className="text-zinc-500 text-sm">Aún no hay proveedores cargados</p>
            <p className="text-zinc-600 text-xs">Agregá uno con el botón de arriba</p>
          </div>
        : <div className="space-y-2">
            {proveedores.map(pr=>{
              const sal=saldo(pr.movimientos);
              const totalDebe=pr.movimientos.reduce((a,m)=>a+(m.debe||0),0);
              const totalHaber=pr.movimientos.reduce((a,m)=>a+(m.haber||0),0);
              return (
                <button key={pr.id} onClick={()=>{setProvSel(pr.id);setPaginaMov(1);}}
                  className="w-full text-left rounded-xl p-4 transition-all hover:scale-[1.01]"
                  style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{pr.nombre}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{pr.movimientos.length} movimiento{pr.movimientos.length!==1?"s":""}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-zinc-500">Debe: <span className="text-red-400 font-medium">{fmt(totalDebe)}</span></p>
                      <p className="text-xs text-zinc-500">Haber: <span className="text-emerald-400 font-medium">{fmt(totalHaber)}</span></p>
                      <p className={`text-sm font-bold mt-0.5 ${sal>=0?"text-emerald-400":"text-red-400"}`}>
                        Saldo: {fmtSaldo(sal)}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
      }

      {/* Modal nuevo proveedor */}
      {modalProv&&(
        <ModalNuevoProveedor onClose={()=>setModalProv(false)} onSave={agregarProveedor}/>
      )}
    </div>
  );

  // ── CUENTA CORRIENTE DEL PROVEEDOR ──
  const movTodos=[...provActual.movimientos].sort((a,b)=>b.fecha.localeCompare(a.fecha));
  const totalDebe =provActual.movimientos.reduce((a,m)=>a+(m.debe||0),0);
  const totalHaber=provActual.movimientos.reduce((a,m)=>a+(m.haber||0),0);
  const salActual =saldo(provActual.movimientos);

  // Calcular saldo acumulado por movimiento (orden cronológico)
  const movsConSaldo=[...provActual.movimientos]
    .sort((a,b)=>a.fecha.localeCompare(b.fecha))
    .reduce((acc,m,i)=>{
      const prev=i>0?acc[i-1].saldoAcum:0;
      acc.push({...m,saldoAcum:prev+(m.haber||0)-(m.debe||0)});
      return acc;
    },[])
    .sort((a,b)=>b.fecha.localeCompare(a.fecha));

  const movsConSaldoPag=movsConSaldo.slice((paginaMov-1)*POR_PAG_MOV,paginaMov*POR_PAG_MOV);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={()=>setProvSel(null)} className="mt-1 text-amber-400/60 hover:text-amber-400 text-lg">←</button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-white">{provActual.nombre}</h2>
          <p className="text-xs text-zinc-500 uppercase tracking-widest">Cuenta corriente</p>
        </div>
        <div className="flex gap-2">
          <button onClick={()=>setModalMov(true)} className="px-3 py-2 rounded-xl text-sm font-bold"
            style={{background:"linear-gradient(135deg,#d4af37,#b8932a)",color:"#1a1a2e"}}>+ Movimiento</button>
          <button onClick={eliminarProveedor} className="px-3 py-2 rounded-xl text-sm"
            style={{background:"rgba(239,68,68,0.15)",color:"#f87171",border:"1px solid rgba(239,68,68,0.3)"}}>🗑️</button>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {label:"Total Debe",value:fmt(totalDebe),color:"#f87171",icon:"📤"},
          {label:"Total Haber",value:fmt(totalHaber),color:"#34d399",icon:"📥"},
          {label:"Saldo actual",value:fmtSaldo(salActual),color:salActual>=0?"#34d399":"#f87171",icon:"⚖️"},
        ].map(s=>(
          <div key={s.label} className="rounded-xl p-3 text-center"
            style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
            <div className="text-xl mb-1">{s.icon}</div>
            <div className="text-sm font-bold" style={{color:s.color}}>{s.value}</div>
            <div className="text-xs text-zinc-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Aclaración */}
      <div className="rounded-lg px-3 py-2 text-xs text-zinc-500 flex gap-4"
        style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.05)"}}>
        <span>📤 <span className="text-red-400">Debe</span> = lo que compramos / debemos</span>
        <span>📥 <span className="text-emerald-400">Haber</span> = lo que pagamos</span>
      </div>

      {/* Tabla de movimientos */}
      <div>
        <p className="text-xs uppercase tracking-widest text-amber-400/60 mb-3">
          Movimientos ({provActual.movimientos.length})
        </p>
        {provActual.movimientos.length===0
          ? <p className="text-sm text-zinc-600 text-center py-8">Sin movimientos registrados</p>
          : <>
            <div className="space-y-2">
              {movsConSaldoPag.map(m=>(
                <div key={m.id} className="rounded-xl p-3" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)"}}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white break-words">{m.detalle}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs text-zinc-500">{fmtFecha(m.fecha)}</span>
                        {m.metodoPago&&<MetodoBadge metodo={m.metodoPago}/>}
                      </div>
                      {m.nota&&<p className="text-xs text-zinc-600 italic mt-1">{m.nota}</p>}
                    </div>
                    <button onClick={()=>eliminarMovimiento(m.id)} className="text-xs px-2 py-1 rounded-lg shrink-0"
                      style={{background:"rgba(239,68,68,0.15)",color:"#f87171",border:"1px solid rgba(239,68,68,0.3)"}}>🗑️</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                    <div className="rounded-lg py-1.5 px-1" style={{background:"rgba(239,68,68,0.08)"}}>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500">Debe</p>
                      <p className="text-sm font-bold text-red-400">{m.debe>0?fmt(m.debe):"—"}</p>
                    </div>
                    <div className="rounded-lg py-1.5 px-1" style={{background:"rgba(52,211,153,0.08)"}}>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500">Haber</p>
                      <p className="text-sm font-bold text-emerald-400">{m.haber>0?fmt(m.haber):"—"}</p>
                    </div>
                    <div className="rounded-lg py-1.5 px-1" style={{background:"rgba(255,255,255,0.04)"}}>
                      <p className="text-[10px] uppercase tracking-wider text-zinc-500">Saldo</p>
                      <p className={`text-sm font-bold ${m.saldoAcum>=0?"text-emerald-400":"text-red-400"}`}>{fmtSaldo(m.saldoAcum)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Paginador total={provActual.movimientos.length} porPagina={POR_PAG_MOV} pagina={paginaMov} onChange={setPaginaMov}/>
          </>
        }
      </div>

      {modalMov&&<ModalMovimientoProveedor onClose={()=>setModalMov(false)} onSave={agregarMovimiento}/>}
    </div>
  );
}

// ── MODALES PROVEEDOR ──────────────────────────────────────────────────────────
function ModalNuevoProveedor({onClose,onSave}) {
  const [nombre,setNombre]=useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.75)",backdropFilter:"blur(6px)"}}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl" style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.3)"}}>
        <div className="px-6 py-4 flex items-center justify-between" style={{background:"rgba(212,175,55,0.08)",borderBottom:"1px solid rgba(212,175,55,0.2)"}}>
          <h3 className="text-lg font-bold text-white">Nuevo proveedor</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="p-6">
          <label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Nombre del proveedor</label>
          <input type="text" value={nombre} onChange={e=>setNombre(e.target.value)}
            placeholder="Ej: Distribuidora Pelo Sano..."
            className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-zinc-600"
            style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}
            onKeyDown={e=>e.key==="Enter"&&onSave(nombre)}/>
        </div>
        <div className="px-6 py-4 flex gap-3" style={{borderTop:"1px solid rgba(212,175,55,0.15)"}}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm text-zinc-400"
            style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>Cancelar</button>
          <button onClick={()=>onSave(nombre)} className="flex-1 py-2.5 rounded-xl text-sm font-bold"
            style={{background:"linear-gradient(135deg,#d4af37,#b8932a)",color:"#1a1a2e"}}>Crear</button>
        </div>
      </div>
    </div>
  );
}

function ModalMovimientoProveedor({onClose,onSave}) {
  const [fecha,setFecha]=useState(hoyStr());
  const [detalle,setDetalle]=useState("");
  const [tipo,setTipo]=useState("debe");       // "debe" o "haber"
  const [monto,setMonto]=useState("");
  const [metodoPago,setMetodoPago]=useState("efectivo");
  const [nota,setNota]=useState("");

  const guardar=()=>{
    if(!detalle.trim()) return alert("Escribí un detalle");
    if(!monto||Number(monto)<=0) return alert("Ingresá un monto válido");
    onSave({
      fecha,detalle,
      debe:  tipo==="debe"  ? Number(monto) : 0,
      haber: tipo==="haber" ? Number(monto) : 0,
      metodoPago: tipo==="haber" ? metodoPago : null,
      nota,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(0,0,0,0.75)",backdropFilter:"blur(6px)"}}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl" style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.3)"}}>
        <div className="px-6 py-4 flex items-center justify-between" style={{background:"rgba(212,175,55,0.08)",borderBottom:"1px solid rgba(212,175,55,0.2)"}}>
          <h3 className="text-lg font-bold text-white">Nuevo movimiento</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          {/* Tipo */}
          <div className="grid grid-cols-2 gap-2">
            {[["debe","📤 Debe (compra/deuda)","red"],["haber","📥 Haber (pago)","green"]].map(([v,lbl,c])=>(
              <button key={v} onClick={()=>setTipo(v)}
                className="py-2.5 rounded-xl text-sm font-bold transition-all"
                style={{
                  background:tipo===v?(c==="red"?"rgba(239,68,68,0.2)":"rgba(52,211,153,0.2)"):"rgba(255,255,255,0.04)",
                  border:tipo===v?(c==="red"?"1px solid rgba(239,68,68,0.5)":"1px solid rgba(52,211,153,0.5)"):"1px solid rgba(255,255,255,0.08)",
                  color:tipo===v?(c==="red"?"#f87171":"#34d399"):"#71717a"
                }}>{lbl}</button>
            ))}
          </div>
          {/* Fecha */}
          <div>
            <label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Fecha</label>
            <input type="date" value={fecha} onChange={e=>setFecha(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm text-white"
              style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
          </div>
          {/* Detalle */}
          <div>
            <label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Detalle</label>
            <input type="text" value={detalle} onChange={e=>setDetalle(e.target.value)}
              placeholder="Ej: Compra tinturas rubias, Pago factura..."
              className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-zinc-600"
              style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
          </div>
          {/* Monto + Método */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Monto ($)</label>
              <input type="number" value={monto} onChange={e=>setMonto(e.target.value)} placeholder="0"
                className="w-full px-3 py-2 rounded-lg text-sm text-white"
                style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
            </div>
            {tipo==="haber"&&(
              <div>
                <label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Forma de pago</label>
                <select value={metodoPago} onChange={e=>setMetodoPago(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm text-white"
                  style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.25)"}}>
                  <option value="efectivo">💵 Efectivo</option>
                  <option value="tarjeta">💳 Tarjeta</option>
                  <option value="transferencia">🏦 Transferencia</option>
                  <option value="qr">📱 QR</option>
                </select>
              </div>
            )}
          </div>
          {/* Nota */}
          <div>
            <label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Nota (opcional)</label>
            <input type="text" value={nota} onChange={e=>setNota(e.target.value)}
              placeholder="Aclaración adicional..."
              className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-zinc-600"
              style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
          </div>
        </div>
        <div className="px-6 py-4 flex gap-3" style={{borderTop:"1px solid rgba(212,175,55,0.15)"}}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm text-zinc-400"
            style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.08)"}}>Cancelar</button>
          <button onClick={guardar} className="flex-1 py-2.5 rounded-xl text-sm font-bold"
            style={{background:"linear-gradient(135deg,#d4af37,#b8932a)",color:"#1a1a2e"}}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ── APP PRINCIPAL ─────────────────────────────────────────────────────────────
function AppGestion({usuario}) {
  const [clientesNube,setClientes]=useColeccion("gestion_clientes");
  const clientes=useMemo(()=>clientesNube||[],[clientesNube]);
  const [busqueda,setBusqueda]=useState("");
  const [filtro,setFiltro]=useState("todos");
  const [filtroMes,setFiltroMes]=useState("");  // "" = todos, "YYYY-MM" = mes especifico
  const [paginaClientes,setPaginaClientes]=useState(1);
  const POR_PAG_CLIENTES=10;
  const [clienteActivo,setClienteActivo]=useState(null);
  const [modal,setModal]=useState(null);
  const [pestana,setPestana]=useState("clientes");
  const [modalReset,setModalReset]=useState(false);

  const resetPagClientes=()=>setPaginaClientes(1);

  const filtrados=useMemo(()=>{
    let r=clientes;
    if(busqueda) r=r.filter(c=>c.nombre.toLowerCase().includes(busqueda.toLowerCase())||c.telefono?.includes(busqueda));
    if(filtro==="deuda") r=r.filter(c=>deudaCliente(c)>0);
    if(filtroMes) r=r.filter(c=>c.visitas.some(v=>v.fecha.startsWith(filtroMes)));
    return r.sort((a,b)=>{const ua=ultimaVisita(a);const ub=ultimaVisita(b);if(!ua&&!ub)return 0;if(!ua)return 1;if(!ub)return -1;return ub.fecha.localeCompare(ua.fecha);});
  },[clientes,busqueda,filtro,filtroMes]);

  // Meses disponibles con actividad (para el selector)
  const mesesDisponibles=useMemo(()=>{
    const set=new Set();
    clientes.forEach(c=>c.visitas.forEach(v=>set.add(v.fecha.slice(0,7))));
    return [...set].sort((a,b)=>b.localeCompare(a));
  },[clientes]);

  const totalDeuda=clientes.reduce((a,c)=>a+deudaCliente(c),0);
  const conDeuda=clientes.filter(c=>deudaCliente(c)>0).length;

  const agregarCliente=(c)=>{setClientes(p=>[...p,c]);setModal(null);};
  const actualizarCliente=(c)=>{setClientes(p=>p.map(x=>x.id===c.id?c:x));setModal(null);};
  const eliminarCliente=(id)=>{if(!window.confirm("¿Eliminar este cliente y todo su historial?"))return;setClientes(p=>p.filter(c=>c.id!==id));setClienteActivo(null);};

  const agregarVisita=(v)=>{setClientes(p=>p.map(c=>c.id===clienteActivo.id?{...c,visitas:[...c.visitas,v]}:c));setClienteActivo(c=>({...c,visitas:[...c.visitas,v]}));setModal(null);};
  const editarVisita=(v)=>setClientes(p=>p.map(c=>c.id!==clienteActivo.id?c:{...c,visitas:c.visitas.map(x=>x.id===v.id?v:x)}));
  const eliminarVisita=(vid)=>setClientes(p=>p.map(c=>c.id!==clienteActivo.id?c:{...c,visitas:c.visitas.filter(x=>x.id!==vid)}));

  const registrarPago=(deuda)=>{
    const op=prompt(`¿Con qué método paga ${fmt(deuda)}?\n1. Efectivo\n2. Tarjeta\n3. Transferencia\n4. QR`);
    const mapa={"1":"efectivo","2":"tarjeta","3":"transferencia","4":"qr"};
    const mp=mapa[op]||"efectivo";
    setClientes(p=>p.map(c=>{if(c.id!==clienteActivo.id)return c;let r=deuda;const visitas=c.visitas.map(v=>{const pen=v.total-v.pagado;if(pen<=0||r<=0)return v;const ab=Math.min(pen,r);r-=ab;return{...v,pagado:v.pagado+ab,metodoPago:mp};});return{...c,visitas};}));
    setClienteActivo(c=>{let r=deuda;const visitas=c.visitas.map(v=>{const pen=v.total-v.pagado;if(pen<=0||r<=0)return v;const ab=Math.min(pen,r);r-=ab;return{...v,pagado:v.pagado+ab};});return{...c,visitas};});
  };

  // ── RESPALDO: exportar / importar ──
  const [ultimoRespaldo,setUltimoRespaldo]=useState(()=>{try{return localStorage.getItem(STORAGE_ULTIMO_RESPALDO)||"";}catch(_){return "";}});

  const descargarJSON=(paquete)=>{
    const blob=new Blob([JSON.stringify(paquete,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`fusion-respaldo-${hoyStr()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportarDatos=async()=>{
    try{
      const datos={};
      for(const [clave,nombre] of Object.entries(COLECCIONES)) datos[clave]=await leerColeccion(nombre);
      descargarJSON({app:"fusion-peluqueria",version:1,exportado:new Date().toISOString(),datos});
      try{localStorage.setItem(STORAGE_ULTIMO_RESPALDO,hoyStr());}catch(_){}
      setUltimoRespaldo(hoyStr());
    }catch(err){
      alert("No se pudo generar el respaldo: "+err.message);
    }
  };

  // Importar = SUBIR a la nube los registros del archivo (no borra nada; si el id ya existe, se sobrescribe)
  const importarDatos=(e)=>{
    const archivo=e.target.files?.[0];
    e.target.value="";
    if(!archivo) return;
    const lector=new FileReader();
    lector.onload=async()=>{
      try{
        const paquete=JSON.parse(lector.result);
        if(paquete.app!=="fusion-peluqueria"||!paquete.datos) return alert("Este archivo no es un respaldo válido de la app.");
        const nClientes=Array.isArray(paquete.datos[STORAGE_KEY])?paquete.datos[STORAGE_KEY].length:0;
        const ok=window.confirm(`Vas a SUBIR a la nube el respaldo del ${paquete.exportado?.slice(0,10)||"—"} (${nClientes} clientes).\n\nNo se borra nada: los registros nuevos se agregan y los que ya existan se sobrescriben.\n\n¿Continuar?`);
        if(!ok) return;
        let total=0;
        for(const [clave,nombre] of Object.entries(COLECCIONES)) total+=await subirRegistros(nombre,paquete.datos[clave]);
        alert(`Listo: se subieron ${total} registros.`);
      }catch(err){
        alert("No se pudo importar el archivo: "+err.message);
      }
    };
    lector.readAsText(archivo);
  };

  // Migración única: datos que quedaron en el navegador (versión anterior sin nube)
  const [pendienteMigrar,setPendienteMigrar]=useState(()=>{
    try{
      if(localStorage.getItem(STORAGE_MIGRADO)) return false;
      return CLAVES_RESPALDO.some(k=>{const r=localStorage.getItem(k);if(!r) return false;const v=JSON.parse(r);return Array.isArray(v)&&v.length>0;});
    }catch(_){return false;}
  });
  const migrarLocalANube=async()=>{
    if(!window.confirm("Vas a subir a la nube los datos guardados en ESTE navegador.\n\nHacelo una sola vez y solo desde el navegador donde tenés tus datos reales.\n\n¿Continuar?")) return;
    try{
      let total=0;
      for(const [clave,nombre] of Object.entries(COLECCIONES)){
        const r=localStorage.getItem(clave);
        if(r) total+=await subirRegistros(nombre,JSON.parse(r));
      }
      localStorage.setItem(STORAGE_MIGRADO,hoyStr());
      setPendienteMigrar(false);
      alert(`Listo: se subieron ${total} registros a la nube.`);
    }catch(err){
      alert("No se pudo subir: "+err.message);
    }
  };

  const diasSinRespaldo=ultimoRespaldo?Math.floor((new Date(hoyStr())-new Date(ultimoRespaldo))/86400000):null;
  const respaldoViejo=diasSinRespaldo===null||diasSinRespaldo>=7;

  const restaurarTodo=async()=>{
    try{
      for(const nombre of Object.values(COLECCIONES)) await borrarColeccion(nombre);
    }catch(err){
      alert("No se pudo borrar: "+err.message);
      return;
    }
    setModalReset(false);
    setPestana("clientes");
    setClienteActivo(null);
  };

  const clienteActualizado=clienteActivo?clientes.find(c=>c.id===clienteActivo.id):null;

  if(clientesNube===null) return (
    <div className="min-h-screen flex items-center justify-center" style={{background:"#13131f"}}>
      <p className="text-sm text-zinc-500">Cargando datos…</p>
    </div>
  );

  return (
    <div className="min-h-screen pb-24" style={{background:"#13131f",fontFamily:"'Segoe UI', sans-serif"}}>
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <span className="text-3xl">✂️</span>
            <div><h1 className="text-2xl font-bold tracking-tight" style={{color:"#d4af37"}}>Peluquería</h1>
              <p className="text-xs text-zinc-500 tracking-widest uppercase">Sistema de gestión</p>
            </div>
          </div>
          {!clienteActualizado&&(
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <button onClick={exportarDatos} className="text-xs px-3 py-1.5 rounded-lg transition-colors" style={{background:"rgba(52,211,153,0.12)",color:"#34d399",border:"1px solid rgba(52,211,153,0.3)"}}>
                ⬇️ Respaldo
              </button>
              <label className="text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer" style={{background:"rgba(212,175,55,0.12)",color:"#d4af37",border:"1px solid rgba(212,175,55,0.3)"}}>
                ⬆️ Importar
                <input type="file" accept=".json,application/json" onChange={importarDatos} className="hidden"/>
              </label>
              <button onClick={()=>setModalReset(true)} className="text-xs px-3 py-1.5 rounded-lg transition-colors" style={{background:"rgba(239,68,68,0.1)",color:"#f87171",border:"1px solid rgba(239,68,68,0.2)"}}>
                🔄 Restaurar
              </button>
              <button onClick={()=>signOut(auth)} title={usuario?.email} className="text-xs px-3 py-1.5 rounded-lg transition-colors" style={{background:"rgba(255,255,255,0.05)",color:"#a1a1aa",border:"1px solid rgba(255,255,255,0.1)"}}>
                Salir
              </button>
            </div>
          )}
        </div>
        {!clienteActualizado&&pendienteMigrar&&(
          <div className="rounded-lg px-3 py-2 mb-4 text-xs flex items-center justify-between gap-3" style={{background:"rgba(52,211,153,0.1)",border:"1px solid rgba(52,211,153,0.3)",color:"#34d399"}}>
            <span>☁️ Hay datos guardados en este navegador que todavía no están en la nube.</span>
            <button onClick={migrarLocalANube} className="font-bold underline shrink-0">Subir a la nube</button>
          </div>
        )}
        {!clienteActualizado&&respaldoViejo&&(
          <div className="rounded-lg px-3 py-2 mb-4 text-xs flex items-center justify-between gap-3" style={{background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.3)",color:"#fbbf24"}}>
            <span>⚠️ {ultimoRespaldo?`Hace ${diasSinRespaldo} días que no descargás un respaldo.`:"Todavía no descargaste ningún respaldo."}</span>
            <button onClick={exportarDatos} className="font-bold underline shrink-0">Descargar ahora</button>
          </div>
        )}

        {/* Tabs */}
        {!clienteActualizado&&(
          <div className="flex gap-2 mb-6 flex-wrap">
            {[["clientes","👤 Clientes"],["caja","💰 Caja"],["calendario","📅 Calendario"],["profesionales","💈 Profesionales"],["proveedores","🏪 Proveedores"]].map(([v,lbl])=>(
              <button key={v} onClick={()=>setPestana(v)}
                className="px-4 py-2 rounded-xl text-sm font-bold transition-all"
                style={{background:pestana===v?"linear-gradient(135deg, #d4af37, #b8932a)":"rgba(255,255,255,0.04)",border:pestana===v?"none":"1px solid rgba(255,255,255,0.08)",color:pestana===v?"#1a1a2e":"#71717a"}}>
                {lbl}
              </button>
            ))}
          </div>
        )}

        {/* ── CLIENTES ── */}
        {(pestana==="clientes"||clienteActualizado)&&(
          <>
            {!clienteActualizado&&(
              <div className="grid grid-cols-3 gap-3 mb-6">
                {[{label:"Clientes",value:clientes.length,icon:"👤"},{label:"Con deuda",value:conDeuda,icon:"⚠️",red:conDeuda>0},{label:"Deuda total",value:fmt(totalDeuda),icon:"💸",red:totalDeuda>0}].map(s=>(
                  <div key={s.label} className="rounded-xl p-3 text-center" style={{background:"rgba(212,175,55,0.06)",border:"1px solid rgba(212,175,55,0.12)"}}>
                    <div className="text-xl mb-0.5">{s.icon}</div>
                    <div className={`text-base font-bold ${s.red&&(s.value>0||totalDeuda>0)?"text-red-400":"text-amber-300"}`}>{s.value}</div>
                    <div className="text-xs text-zinc-500">{s.label}</div>
                  </div>
                ))}
              </div>
            )}
            {clienteActualizado?(
              <DetalleCliente
                cliente={clienteActualizado}
                onBack={()=>setClienteActivo(null)}
                onEditarCliente={()=>setModal("editarCliente")}
                onEliminarCliente={()=>eliminarCliente(clienteActualizado.id)}
                onNuevaVisita={()=>setModal("nuevaVisita")}
                onEditarVisita={editarVisita}
                onEliminarVisita={eliminarVisita}
                onPagarDeuda={registrarPago}
              />
            ):(
              <>
                <div className="flex gap-3 mb-4">
                  <div className="flex-1 relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">🔍</span>
                    <input value={busqueda} onChange={e=>{setBusqueda(e.target.value);resetPagClientes();}} placeholder="Buscar por nombre o teléfono..."
                      className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-white placeholder-zinc-600"
                      style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(212,175,55,0.2)"}}/>
                  </div>
                  <button onClick={()=>setModal("nuevoCliente")} className="px-4 py-2.5 rounded-xl text-sm font-bold shrink-0" style={{background:"linear-gradient(135deg, #d4af37, #b8932a)",color:"#1a1a2e"}}>+ Nuevo</button>
                </div>
                <div className="space-y-3 mb-5">
                  {/* Filtros estado */}
                  <div className="flex gap-2 flex-wrap">
                    {[["todos","Todos"],["deuda",`Con deuda (${conDeuda})`]].map(([v,lbl])=>(
                      <button key={v} onClick={()=>{setFiltro(v);resetPagClientes();}} className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{background:filtro===v?"rgba(212,175,55,0.2)":"rgba(255,255,255,0.04)",border:filtro===v?"1px solid rgba(212,175,55,0.5)":"1px solid rgba(255,255,255,0.08)",color:filtro===v?"#d4af37":"#71717a"}}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                  {/* Filtro por mes — selector compacto */}
                  {mesesDisponibles.length>0&&(
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500">📅</span>
                      <select
                        value={filtroMes}
                        onChange={e=>{setFiltroMes(e.target.value);resetPagClientes();}}
                        className="flex-1 px-3 py-2 rounded-xl text-sm text-white"
                        style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${filtroMes?"rgba(212,175,55,0.5)":"rgba(255,255,255,0.08)"}`,color:filtroMes?"#d4af37":"#a1a1aa"}}>
                        <option value="">📅 Todos los meses</option>
                        {mesesDisponibles.map(m=>{
                          const [y,mo]=m.split("-");
                          const lbl=`${MESES[parseInt(mo)-1]} ${y}`;
                          return <option key={m} value={m}>{lbl}</option>;
                        })}
                      </select>
                      {filtroMes&&(
                        <button onClick={()=>{setFiltroMes("");resetPagClientes();}}
                          className="text-xs px-2 py-2 rounded-xl text-zinc-500 hover:text-white transition-colors shrink-0"
                          style={{background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)"}}>
                          × Limpiar
                        </button>
                      )}
                    </div>
                  )}
                  {/* Indicador resultados */}
                  {(filtroMes||filtro!=="todos"||busqueda)&&(
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-amber-400/60">{filtrados.length} cliente{filtrados.length!==1?"s":""} encontrado{filtrados.length!==1?"s":""}</span>
                      {(filtroMes||filtro!=="todos")&&(
                        <button onClick={()=>{setFiltroMes("");setFiltro("todos");resetPagClientes();}} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">× Limpiar filtros</button>
                      )}
                    </div>
                  )}
                </div>
                {filtrados.length===0?<p className="text-center text-zinc-600 text-sm py-12">No se encontraron clientes</p>:(
                  <>
                    <div className="space-y-2">
                      {filtrados.slice((paginaClientes-1)*POR_PAG_CLIENTES, paginaClientes*POR_PAG_CLIENTES).map(c=>{const deuda=deudaCliente(c);const ultima=ultimaVisita(c);return(
                        <button key={c.id} onClick={()=>setClienteActivo(c)} className="w-full text-left rounded-xl p-4 transition-all hover:scale-[1.01]" style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)"}}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-white text-sm">{c.nombre}</span>
                                {deuda>0&&<Badge color="red">Debe {fmt(deuda)}</Badge>}
                              </div>
                              <div className="flex items-center gap-3 mt-1 flex-wrap">
                                {c.telefono&&<span className="text-xs text-zinc-500">{c.telefono}</span>}
                                {ultima&&<span className="text-xs text-zinc-600">Última: <span className="text-zinc-400">{fmtFecha(ultima.fecha)}</span> · {ultima.profesional}</span>}
                              </div>
                              {c.notas&&<p className="text-xs text-amber-300/50 mt-0.5 italic truncate">{c.notas}</p>}
                            </div>
                            <div className="text-right shrink-0 ml-3">
                              <div className="text-sm font-bold text-amber-400">{c.visitas.length} visitas</div>
                              <div className="text-xs text-zinc-600">{fmt(c.visitas.reduce((a,v)=>a+v.total,0))}</div>
                            </div>
                          </div>
                        </button>
                      );})}
                    </div>
                    <Paginador total={filtrados.length} porPagina={POR_PAG_CLIENTES} pagina={paginaClientes} onChange={setPaginaClientes}/>
                  </>
                )}
              </>
            )}
          </>
        )}

        {pestana==="caja"&&!clienteActualizado&&<VistaCaja clientes={clientes}/>}
        {pestana==="calendario"&&!clienteActualizado&&<VistaCalendario clientes={clientes}/>}
        {pestana==="profesionales"&&!clienteActualizado&&<VistaProfesionales/>}
        {pestana==="proveedores"&&!clienteActualizado&&<VistaProveedores/>}
      </div>

      {modal==="nuevoCliente"  &&<ModalCliente onClose={()=>setModal(null)} onSave={agregarCliente} clientesExistentes={clientes}/>}
      {modal==="editarCliente" &&clienteActualizado&&<ModalCliente cliente={clienteActualizado} onClose={()=>setModal(null)} onSave={actualizarCliente}/>}
      {modal==="nuevaVisita"   &&clienteActualizado&&<FormVisita titulo={`Nueva visita — ${clienteActualizado.nombre}`} onClose={()=>setModal(null)} onSave={agregarVisita}/>}
      {modalReset&&<ModalRestaurar onClose={()=>setModalReset(false)} onConfirm={restaurarTodo}/>}
    </div>
  );
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function PantallaLogin() {
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState("");
  const [error,setError]=useState("");
  const [cargando,setCargando]=useState(false);

  const entrar=async()=>{
    if(!email.trim()||!pass) return setError("Completá el email y la contraseña");
    setCargando(true); setError("");
    try{
      await signInWithEmailAndPassword(auth,email.trim(),pass);
    }catch(err){
      const codigos=["auth/invalid-credential","auth/wrong-password","auth/user-not-found","auth/invalid-email"];
      setError(codigos.includes(err.code)?"Email o contraseña incorrectos":"No se pudo ingresar: "+err.message);
      setCargando(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{background:"#13131f",fontFamily:"'Segoe UI', sans-serif"}}>
      <div className="w-full max-w-sm rounded-2xl p-6 space-y-4" style={{background:"#1a1a2e",border:"1px solid rgba(212,175,55,0.3)"}}>
        <div className="text-center">
          <div className="text-4xl mb-1">✂️</div>
          <h1 className="text-xl font-bold" style={{color:"#d4af37"}}>Fusión</h1>
          <p className="text-xs text-zinc-500 uppercase tracking-widest">Sistema de gestión</p>
        </div>
        <div>
          <label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Email</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="username"
            className="w-full px-3 py-2 rounded-lg text-sm text-white"
            style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
        </div>
        <div>
          <label className="text-xs text-amber-400/70 uppercase tracking-widest block mb-1.5">Contraseña</label>
          <input type="password" value={pass} onChange={e=>setPass(e.target.value)} autoComplete="current-password"
            onKeyDown={e=>e.key==="Enter"&&entrar()}
            className="w-full px-3 py-2 rounded-lg text-sm text-white"
            style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(212,175,55,0.25)"}}/>
        </div>
        {error&&<p className="text-xs text-red-400">{error}</p>}
        <button onClick={entrar} disabled={cargando} className="w-full py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
          style={{background:"linear-gradient(135deg, #d4af37, #b8932a)",color:"#1a1a2e"}}>
          {cargando?"Ingresando…":"Ingresar"}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [usuario,setUsuario]=useState(undefined); // undefined = verificando sesión
  useEffect(()=>onAuthStateChanged(auth,u=>setUsuario(u||null)),[]);
  if(usuario===undefined) return (
    <div className="min-h-screen flex items-center justify-center" style={{background:"#13131f"}}>
      <p className="text-sm text-zinc-500">Cargando…</p>
    </div>
  );
  if(!usuario) return <PantallaLogin/>;
  return <AppGestion usuario={usuario}/>;
}