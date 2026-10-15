const {contextBridge,ipcRenderer:r}=require('electron');
contextBridge.exposeInMainWorld('api',{
  get:id=>r.invoke('get',id),
  save:(id,html)=>r.send('save',id,html),
  color:(id,c)=>r.send('color',id,c),
  z:id=>r.invoke('z',id),
  glass:id=>r.invoke('glass',id),
  cols:(id,v)=>r.send('cols',id,v),
  add:()=>r.send('new'),
  del:id=>r.send('del',id),
  close:()=>r.send('close'),
  onSet:f=>r.on('set',(_,n)=>f(n)),
});
