import {mkdirSync,readFileSync,readdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadCodeCatalogue} from './code-catalogue.mjs';
const assets={};
const hostingConfig=process.env.SHAREPASS_HOSTING_CONFIG_PATH;
const artworkPath=process.env.SHAREPASS_ARTWORK_PATH;
if(hostingConfig&&(!artworkPath||!process.env.SHAREPASS_CODE_MASTER_PATH)){
  throw Error('A private Sites build requires the approved artwork and private code catalogue.');
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.webmanifest':'application/manifest+json'};
function collect(dir,prefix=''){
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    const file=join(dir,entry.name),key=prefix+'/'+entry.name;
    if(entry.isDirectory()){collect(file,key);continue;}
    const type=types[entry.name.slice(entry.name.lastIndexOf('.'))];
    if(type)assets[key]=[type,readFileSync(file).toString('base64')];
  }
}
collect('web');
if(artworkPath)assets['/assets/sharepass-approved-logo.jpg']=['image/jpeg',readFileSync(artworkPath).toString('base64')];
const engine=['phone','demo-store'].map(file=>readFileSync('web/'+file+'.js','utf8')).join('\n');
const registry='const CODE_MASTER='+JSON.stringify(loadCodeCatalogue())+';'+String.fromCharCode(10);
const worker=['code-policy','mobile','intake','booth','setup','push','web-push','owner','ledger','staff-prompts','index'].map(file=>readFileSync('worker/'+file+'.js','utf8')).join('\n');
mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
writeFileSync('dist/server/index.js','const assets='+JSON.stringify(assets)+';\n'+engine+'\n'+registry+worker);
copyFileSync(hostingConfig||'.openai/hosting.json','dist/.openai/hosting.json');
