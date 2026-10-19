const express = require('express');
const dns = require('node:dns').promises;
const net = require('node:net');
const { execFile } = require('node:child_process');
const https = require('node:https');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const MAX_BODY = '16kb';
app.disable('x-powered-by');
app.use(express.json({limit:MAX_BODY}));
app.use(express.static(path.join(__dirname,'public')));
fs.mkdirSync(DATA_DIR,{recursive:true});
if(!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE,'[]\n');

function readHistory(){try{const x=JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8'));return Array.isArray(x)?x:[]}catch{return []}}
function saveHistory(rows){fs.writeFileSync(HISTORY_FILE,JSON.stringify(rows.slice(-300),null,2)+'\n')}
function record(type,target,summary,extra={}){const rows=readHistory();rows.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),time:new Date().toISOString(),type,target,summary,...extra});saveHistory(rows)}
function fail(res,status,message){return res.status(status).json({error:message})}
function validHostname(host){return typeof host==='string'&&host.length<=253&&!host.includes('://')&&!/[\s/\\?#@]/.test(host)&&host.split('.').every(s=>s.length>0&&s.length<=63&&/^[a-zA-Z0-9_-]+$/.test(s))}
function isPrivateV4(ip){const p=ip.split('.').map(Number);if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return true;return p[0]===10||p[0]===127||p[0]===0||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&p[1]===168||p[0]>=224||p[0]===100&&p[1]>=64&&p[1]<=127}
function isPrivateIP(ip){if(net.isIPv4(ip))return isPrivateV4(ip);if(net.isIPv6(ip)){const s=ip.toLowerCase();return s==='::1'||s==='::'||s.startsWith('fc')||s.startsWith('fd')||/^fe[89ab]/.test(s)||s.startsWith('::ffff:127.')||s.startsWith('::ffff:10.')||s.startsWith('::ffff:192.168.')}return true}
async function resolvePublic(host){if(net.isIP(host)){if(isPrivateIP(host))throw new Error('Private, loopback, or reserved IP targets are not allowed.');return [{address:host,family:net.isIP(host)}]}if(!validHostname(host))throw new Error('Enter a valid hostname or IP address.');const rows=await dns.lookup(host,{all:true,verbatim:true});if(!rows.length)throw new Error('Hostname did not resolve.');if(rows.some(r=>isPrivateIP(r.address)))throw new Error('Host resolves to a private or reserved address; request blocked.');return rows}
function parsePingOutput(output){let sent=0,received=0,loss=null,avgMs=null;let m=output.match(/(\d+)\s+packets transmitted,\s*(\d+)\s+(?:packets )?received.*?(\d+(?:\.\d+)?)%\s*packet loss/i);if(m){sent=+m[1];received=+m[2];loss=+m[3]}else{m=output.match(/Sent = (\d+), Received = (\d+), Lost = (\d+)/i);if(m){sent=+m[1];received=+m[2];loss=sent?Math.round((sent-received)*100/sent):0}}m=output.match(/(?:rtt|round-trip).*?=\s*[\d.]+\/([\d.]+)\/[\d.]+/i)||output.match(/Average = (\d+)ms/i);if(m)avgMs=Number(m[1]);if(received===0&&sent===0){const replies=(output.match(/bytes from |Reply from /gi)||[]).length;if(replies){received=replies;sent=replies;loss=0;const vals=[...output.matchAll(/time[=<]([\d.]+)\s*ms/gi)].map(x=>Number(x[1]));if(vals.length)avgMs=Math.round(vals.reduce((a,b)=>a+b,0)/vals.length)}}return {sent,received,loss:loss??(sent?Math.round((sent-received)*100/sent):100),avgMs}}
app.get('/api/health',(req,res)=>res.json({ok:true,service:'netops-dashboard',time:new Date().toISOString()}));
app.get('/api/history',(req,res)=>res.json({records:readHistory()}));
app.delete('/api/history',(req,res)=>{saveHistory([]);res.json({ok:true})});
app.post('/api/ping',async(req,res)=>{const target=String(req.body?.target||'').trim();const count=Math.max(1,Math.min(5,Number.parseInt(req.body?.count,10)||3));try{const resolved=await resolvePublic(target);const address=resolved[0].address;const windows=process.platform==='win32';const args=windows?['-n',String(count),'-w','1800',address]:['-c',String(count),'-W','2',address];let output='';try{const result=await execFileAsync('ping',args,{timeout:12000,maxBuffer:100*1024,windowsHide:true});output=(result.stdout||'')+(result.stderr||'')}catch(e){output=(e.stdout||'')+(e.stderr||'');if(!output)output=e.killed?'Ping timed out.':(e.message||'Ping command failed.')}const stats=parsePingOutput(output);const status=stats.received>0?'Replies received':(output.includes('not found')?'Ping utility unavailable':'No replies (timeout or filtered)');record('ping',target,status,{address,...stats});res.json({target,address,status,...stats,output:output.slice(0,5000)})}catch(e){fail(res,400,e.message||'Ping failed')}});

app.post('/api/dns',async(req,res)=>{const hostname=String(req.body?.hostname||'').trim().replace(/\.$/,'');if(!validHostname(hostname)||net.isIP(hostname))return fail(res,400,'Enter a valid domain name, not an IP address.');const start=Date.now();try{const addresses=await dns.lookup(hostname,{all:true,verbatim:true});const durationMs=Date.now()-start;record('dns',hostname,`${addresses.length} address(es) resolved`,{addresses,durationMs});res.json({hostname,addresses,durationMs})}catch(e){fail(res,400,'DNS lookup failed: '+e.message)}});

function requestHeaders(url,method='HEAD'){return new Promise((resolve,reject)=>{const lib=url.protocol==='https:'?https:http;const req=lib.request(url,{method,timeout:6000,headers:{'User-Agent':'NETOPS-Educational-Diagnostics/1.0','Accept':'*/*'}},response=>{const headers=response.headers;response.resume();response.on('end',()=>resolve({status:response.statusCode,headers,location:headers.location||null}))});req.on('timeout',()=>req.destroy(new Error('Request timed out.')));req.on('error',reject);req.end()})}
app.post('/api/security',async(req,res)=>{let url;try{url=new URL(String(req.body?.url||''))}catch{return fail(res,400,'Enter a valid public HTTPS URL.')}if(url.protocol!=='https:')return fail(res,400,'Only HTTPS URLs are allowed.');if(url.username||url.password)return fail(res,400,'URLs containing credentials are not allowed.');if(url.port&&url.port!=='443')return fail(res,400,'Only the standard HTTPS port is allowed.');try{await resolvePublic(url.hostname);const response=await requestHeaders(url,'HEAD');const h=response.headers;const checks=[['strict-transport-security','Strict-Transport-Security'],['content-security-policy','Content-Security-Policy'],['x-content-type-options','X-Content-Type-Options'],['referrer-policy','Referrer-Policy'],['permissions-policy','Permissions-Policy'],['x-frame-options','X-Frame-Options']].map(([key,name])=>({name,present:Boolean(h[key]),value:h[key]||''}));const result={url:url.toString(),hostname:url.hostname,https:true,status:response.status,finalUrl:url.toString(),headers:checks};record('security',url.hostname,`HTTPS status ${response.status}; ${checks.filter(x=>x.present).length}/${checks.length} headers present`);res.json(result)}catch(e){fail(res,400,'Security inspection failed: '+e.message)}});

app.use((req,res)=>res.status(404).json({error:'Not found'}));
app.listen(PORT,()=>console.log(`NET//OPS dashboard running at http://localhost:${PORT}`));
