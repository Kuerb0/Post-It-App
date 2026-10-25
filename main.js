const {app,BrowserWindow,Tray,Menu,ipcMain,nativeImage,dialog,screen}=require('electron');
const S=require('./sync');
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawn,execFileSync}=require('child_process');

const LOCAL=path.join(__dirname,'notes.json');
let DATA=LOCAL; // la ruta real se fija al arrancar (ubicar): en OneDrive, para que las notas se sincronicen entre equipos
const ICON=path.join(__dirname,'assets','icon.png');
const COLORS=['#fff176','#ffab91','#a5d6a7','#81d4fa','#f48fb1','#ce93d8'];
let notes=[],pos={},last='',POS,tray,CFG,cfg={},carpeta=null,firma='',tExp;
const wins=new Map();
const read=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}};
const save=()=>{fs.mkdirSync(path.dirname(DATA),{recursive:true});fs.writeFileSync(DATA,last=JSON.stringify(notes,null,1));exportar()};
const find=id=>notes.find(n=>n.id==id);
const win=e=>BrowserWindow.fromWebContents(e.sender);

// Electron no tiene "siempre debajo": un PowerShell auxiliar llama a SetWindowPos(HWND_BOTTOM)
// con cada handle que le llega por stdin. Se cierra solo cuando muere la app (stdin se cierra).
const PS=`Add-Type -Name W -Namespace N -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);'
while(($l=[Console]::In.ReadLine()) -ne $null){if($l -match '^\\d+$'){[N.W]::SetWindowPos([IntPtr][int64]$l,[IntPtr]1,0,0,0,0,0x13)|Out-Null}}`;
let ps;
function toBottom(w){
  if(!ps){
    ps=spawn('powershell',['-NoProfile','-EncodedCommand',Buffer.from(PS,'utf16le').toString('base64')],{stdio:['pipe','ignore','ignore'],windowsHide:true});
    ps.on('exit',()=>ps=null);ps.stdin.on('error',()=>{});
  }
  ps.stdin.write(w.getNativeWindowHandle().readBigUInt64LE()+'\n');
}
// n.glass: translucida (opacidad .65, texto incluido)
// n.z: undefined = normal · 'top' = encima de todo · 'bottom' = debajo de las demás ventanas
function apply(w,n,now=true){ // now=false: la nota está en uso, baja al perder el foco
  w.setAlwaysOnTop(n.z=='top');
  w.setOpacity(n.glass?0.65:1);
  if(n.z=='bottom'&&now)toBottom(w);
}

// Una ventana sin botón en la barra de tareas no pertenece a ningún escritorio virtual y sale en todos.
// Cada nota se queda en el escritorio donde está (pos[id].desk) y se oculta en los demás; «Mostrar todas» las trae al actual.
const VD='HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VirtualDesktops';
let ahora='',todos=''; // ids en hexadecimal: el escritorio actual y todos los que hay juntos
const hex=v=>{try{return execFileSync('reg',['query',VD,'/v',v],{encoding:'utf8',windowsHide:true}).match(/REG_BINARY\s+([0-9a-f]+)/i)[1].toLowerCase()}catch{return ''}};
const gp=()=>fs.writeFileSync(POS,JSON.stringify(pos));
function aqui(id){ // ¿va esta nota en el escritorio actual? Sin escritorio (o ya no existe) se queda en el actual
  const p=pos[id]||(pos[id]={});
  if(ahora&&(!p.desk||!todos.includes(p.desk))){p.desk=ahora;gp()}
  return !ahora||p.desk==ahora;
}
const colocar=(id,w=wins.get(id))=>{if(w&&!w.isDestroyed())aqui(id)?w.isVisible()||w.showInactive():w.hide()};
const PSD=`$k='HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VirtualDesktops';$p=''
function Lee($n){$b=[Microsoft.Win32.Registry]::GetValue($k,$n,$null);if($b){-join($b|%{$_.ToString('x2')})}}
while(Get-Process -Id ${process.pid} -EA 0){$c=Lee CurrentVirtualDesktop;$i=Lee VirtualDesktopIDs;if(!$c -and $i){$c=$i.Substring(0,32)} # Windows no escribe el actual hasta el primer cambio
$l="$c $i";if($l -ne $p){$p=$l;[Console]::Out.WriteLine($l);[Console]::Out.Flush()};Start-Sleep -Milliseconds 300}`;
function vigilarEscritorio(){ // un PowerShell avisa cada vez que cambia el escritorio; se cierra solo si muere la app
  let b='';
  spawn('powershell',['-NoProfile','-EncodedCommand',Buffer.from(PSD,'utf16le').toString('base64')],{stdio:['ignore','pipe','ignore'],windowsHide:true})
    .stdout.on('data',d=>{
      const l=(b+=d).split(/\r?\n/);b=l.pop();const u=l.pop();
      if(u){[ahora,todos='']=u.trim().split(' ');wins.forEach((w,id)=>colocar(id,w))}
    });
}

if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>showAll());
app.on('window-all-closed',()=>{}); // la app sigue viva en la bandeja

function open(n){
  if(wins.has(n.id)){const w=wins.get(n.id);if(ahora){(pos[n.id]||(pos[n.id]={})).desk=ahora;gp()} // «Mostrar todas»: la trae a este escritorio
    if(w.isMinimized())w.restore();return w.show()}
  const o=100+wins.size*30;
  const w=new BrowserWindow({x:o,y:o,width:340,height:340,minWidth:200,minHeight:150,...pos[n.id],
    icon:ICON,frame:false,skipTaskbar:true,show:false,backgroundColor:n.color,
    webPreferences:{preload:path.join(__dirname,'preload.js')}});
  w.loadFile('note.html',{query:{id:n.id}});
  w.once('ready-to-show',()=>{if(aqui(n.id))w.show();apply(w,n)});
  w.on('blur',()=>{if(find(n.id)?.z=='bottom'&&!w.isDestroyed())toBottom(w)}); // al soltar el foco, vuelve al fondo
  let t;const sp=()=>{pos[n.id]=Object.assign(pos[n.id]||{},w.getBounds());clearTimeout(t);t=setTimeout(gp,300)};
  w.on('moved',sp);w.on('resized',sp);
  w.on('restore',()=>w.setSkipTaskbar(true)); // minimizada sale en la barra de tareas; al volver, deja de salir
  w.on('closed',()=>{wins.delete(n.id);pintarLanz()});
  wins.set(n.id,w);
}
// La principal (n.main, o la primera) siempre se abre al iniciar; las demás solo si no están dormidas (n.dorm)
const principal=()=>notes.find(n=>n.main)||notes[0];
const inicia=n=>!n.dorm||n===principal();
const showAll=()=>notes.filter(n=>wins.has(n.id)||inicia(n)).forEach(open); // las dormidas se despiertan desde el menú de la bandeja
function add(){ // las nuevas nacen dormidas: abiertas ahora, pero no al próximo inicio
  const n={id:crypto.randomUUID(),color:COLORS[Math.random()*COLORS.length|0],html:'',dorm:true};
  notes.push(n);save();open(n);
}

// ---- sincronizacion con el Calendario por una carpeta compartida (ver sync.js)
// notas-<equipo>.json: las lineas con hora bajo una fecha de las notas unidas · agenda-<equipo>.json: lo que escribe el Calendario
const guardarCfg=()=>fs.writeFileSync(CFG,JSON.stringify(cfg));
function exportar(){ // con un respiro: guardar se llama a cada tecla
  clearTimeout(tExp);
  tExp=setTimeout(()=>{
    if(!carpeta)return;
    try{
      S.escribirNotas(carpeta,S.extraer(notes,new Date()));
    }catch(err){console.error('sync',err)}
  },1500);
}
function refrescarAgenda(){
  if(!carpeta)return;
  const f=S.firmaAgenda(carpeta)+'|'+S.iso(new Date());
  if(!f.split('|')[0]||f==firma)return;
  firma=f;
  for(const n of notes)if(n.cal)wins.get(n.id)?.webContents.send('agenda',eventosNotas()); // notas unidas: pintan los eventos bajo sus fechas
}
const eventosNotas=()=>carpeta?S.leerAgenda(carpeta,new Date(Date.now()-7*864e5),40):[]; // la semana pasada y el mes que viene
// ---- lanzador (clic en el icono de la bandeja): miniaturas de las notas, abrir/cerrar, cuáles arrancan y cuál es la principal (lanzador.html)
let lw,lwCerrado=0;
const cl=(v,lo,hi)=>Math.max(lo,Math.min(v,hi));
const pintarLanz=()=>{if(lw&&!lw.isDestroyed())lw.webContents.send('lanz',
  [...notes].sort((a,b)=>(b===principal())-(a===principal())).map(n=>({id:n.id,color:n.color,html:n.html,open:wins.has(n.id),start:inicia(n),main:n===principal()})))};
function lanzador(){
  if(Date.now()-lwCerrado<300)return; // el clic en la bandeja le quita el foco y lo cierra: no reabrirlo al instante
  if(lw)return lw.focus();
  const p=screen.getCursorScreenPoint(),a=screen.getDisplayNearestPoint(p).workArea,W=470,H=330;
  lw=new BrowserWindow({width:W,height:H,x:cl(p.x-W/2,a.x,a.x+a.width-W),y:cl(p.y-H-10,a.y,a.y+a.height-H),
    frame:false,skipTaskbar:true,alwaysOnTop:true,resizable:false,show:false,backgroundColor:'#262626',icon:ICON,
    webPreferences:{preload:path.join(__dirname,'preload.js')}});
  lw.loadFile('lanzador.html');
  lw.once('ready-to-show',()=>{lw.show();pintarLanz()});
  lw.on('blur',()=>lw.close());
  lw.on('closed',()=>{lw=null;lwCerrado=Date.now()});
}
ipcMain.on('lanz',(e,a,id)=>{
  const n=find(id);
  if(a=='menu')return lanzador(); // desde el botón / Ctrl+L de una nota
  if(a=='nueva')add();
  else if(a=='abrir'&&n){open(n);wins.get(id)?.focus()}
  else if(a=='cerrar')wins.get(id)?.close();
  else if(a=='ini'&&n&&n!==principal()){n.dorm=n.dorm?undefined:true;save()}
  else if(a=='main'&&n){notes.forEach(x=>x.main=undefined);n.main=true;n.dorm=undefined;save()}
  if(a=='nueva'||a=='abrir'||a=='esc')lw?.close();else pintarLanz();
});
const menuBandeja=()=>tray.popUpContextMenu(Menu.buildFromTemplate([
  {label:'Nueva nota',click:add},{label:'Traer las abiertas a este escritorio',click:showAll},
  {label:'Carpeta compartida con el Calendario…',click:elegirCarpeta},{type:'separator'},{label:'Salir',click:()=>app.exit()}]));
function elegirCarpeta(){
  const r=dialog.showOpenDialogSync({title:'Carpeta compartida con el Calendario',defaultPath:carpeta||undefined,properties:['openDirectory','createDirectory']});
  if(!r)return;
  cfg.carpeta=r[0];guardarCfg();carpeta=r[0];firma='';exportar();refrescarAgenda();
}
function ubicar(){ // dónde van las notas y qué carpeta se comparte con el Calendario; se fija la primera vez y no cambia solo
  CFG=path.join(app.getPath('userData'),'sync.json');cfg=read(CFG,{});
  const c=S.carpetaCompartida({guardada:cfg.carpeta,raiz:__dirname});
  carpeta=c.ruta;
  if(!cfg.notas){cfg.notas=S.rutaNotas({carpeta:c.origen=='creada'?null:carpeta,local:LOCAL});guardarCfg()} // «creada» = no hay OneDrive: junto a la app
  DATA=cfg.notas;S.migrarNotas(DATA,LOCAL);
}
function iniciarSync(){
  exportar();refrescarAgenda();
  setInterval(refrescarAgenda,15000);
  setInterval(exportar,3600000); // «hoy» y «mañana» cambian de dia aunque la nota no se toque
}

ipcMain.handle('get',(e,id)=>find(id));
ipcMain.on('save',(e,id,html)=>{const n=find(id);if(n){n.html=html;save()}});
ipcMain.on('color',(e,id,c)=>{ // c = #rrggbb elegido en el selector
  const n=find(id);if(!n||!/^#[0-9a-f]{6}$/i.test(c))return;
  n.color=c;save();win(e).setBackgroundColor(c);
});
ipcMain.handle('z',(e,id)=>{ // normal → encima → debajo → normal
  const n=find(id);n.z={undefined:'top',top:'bottom',bottom:undefined}[n.z];
  save();apply(win(e),n,false);return n.z;
});
ipcMain.handle('glass',(e,id)=>{
  const n=find(id);n.glass=n.glass?undefined:true;
  save();apply(win(e),n,false);return !!n.glass;
});
ipcMain.handle('cal',(e,id)=>{ // unir con el Calendario: sus tareas bajo una fecha van al Calendario y ven sus eventos
  const n=find(id);n.cal=n.cal?undefined:true;save();return !!n.cal;
});
ipcMain.handle('agenda',()=>eventosNotas());
ipcMain.on('hechoCal',(e,id,k,v)=>{ // casilla de un evento del Calendario pintado en la nota; k = id del evento (uid@inicio)
  const n=find(id);if(!n)return;
  const s=new Set(n.calHechos),lim=S.iso(new Date(Date.now()-60*864e5));
  v?s.add(k):s.delete(k);
  const l=[...s].filter(x=>x.slice(-19,-9)>=lim); // los de hace más de 60 días ya no se pintan: se olvidan
  n.calHechos=l.length?l:undefined;save();
});
ipcMain.on('cols',(e,id,v)=>{const n=find(id);if(n){n.cols=v||undefined;save()}}); // máx. de columnas (0 = sin columnas)
ipcMain.on('new',add);
ipcMain.on('close',e=>win(e).close());
ipcMain.on('min',e=>{const w=win(e);w.setSkipTaskbar(false);w.minimize()});
ipcMain.on('del',(e,id)=>{
  const n=find(id);if(!n)return;
  if(n.html.replace(/<[^>]*>/g,'').trim()&&dialog.showMessageBoxSync(win(e),
    {type:'question',buttons:['Eliminar','Cancelar'],defaultId:1,cancelId:1,message:'¿Eliminar esta nota?'}))return;
  notes=notes.filter(x=>x!=n);save();win(e).close();
});

app.whenReady().then(()=>{
  Menu.setApplicationMenu(null); // sin menú por defecto: sus atajos (Ctrl+W, Ctrl+R…) no deben pisar los de la nota
  POS=path.join(app.getPath('userData'),'pos.json');
  pos=read(POS,{});
  ubicar();
  todos=hex('VirtualDesktopIDs');ahora=hex('CurrentVirtualDesktop')||todos.slice(0,32);
  let raw='';try{raw=fs.readFileSync(DATA,'utf8')}catch{}
  try{notes=JSON.parse(raw)}catch{notes=[];if(raw.trim())fs.copyFileSync(DATA,DATA+'.ilegible')} // existe pero no se lee: se guarda aparte antes de que nada lo pise
  const nueva=!notes.length;
  if(nueva)notes.push({id:crypto.randomUUID(),color:COLORS[0],html:
    '<div>Bienvenido 👋 Escribe <b>-</b> + espacio para crear una tarea. Pulsa <b>F1</b> para ver los atajos.</div>'+
    '<div>Repetir: @diario @semanal @mensual @lunes @cada3d</div>'+
    '<div><input type="checkbox"> regar plantas @diario</div>'+
    '<div><input type="checkbox"> informe @lunes</div>'});
  if(!nueva)save(); // la bienvenida no se escribe hasta que toques algo: si OneDrive aún no ha bajado tus notas, no las pisa
  showAll();iniciarSync();vigilarEscritorio();

  // arranque con Windows
  app.setLoginItemSettings({openAtLogin:true,path:process.execPath,args:[__dirname]});

  tray=new Tray(nativeImage.createFromPath(ICON).resize({width:16,height:16}));
  tray.setToolTip('Post-its');
  tray.on('click',lanzador);tray.on('right-click',menuBandeja);

  // OneDrive trajo cambios de otro equipo → recargar
  fs.watchFile(DATA,{interval:3000},()=>{
    let s,j;try{s=fs.readFileSync(DATA,'utf8');if(s==last)return;j=JSON.parse(s)}catch{return}
    const had=new Set(notes.map(n=>n.id));last=s;notes=j;exportar();
    for(const [id,w] of wins)if(!find(id))w.close();
    for(const n of notes){
      const w=wins.get(n.id);
      if(!had.has(n.id)){if(inicia(n))open(n)}
      else if(w&&!w.isFocused()){w.setBackgroundColor(n.color);apply(w,n);w.webContents.send('set',n)}
    }
  });
});
