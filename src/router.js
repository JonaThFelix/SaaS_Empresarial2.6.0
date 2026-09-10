'use strict';
function compile(pattern){
 const names=[]; const parts=pattern.split('/').map(seg=>{if(seg.startsWith(':')){names.push(seg.slice(1));return '([^/]+)';}if(seg==='*')return '(.*)';return seg.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');});
 return {regex:new RegExp('^'+parts.join('/')+'/?$'),names};
}
class Router{constructor(){this.routes=[]}add(method,pattern,handler){const c=compile(pattern);this.routes.push({method,pattern,...c,handler})}get(p,h){this.add('GET',p,h)}post(p,h){this.add('POST',p,h)}match(method,path){for(const r of this.routes){if(r.method!==method)continue;const m=r.regex.exec(path);if(m){const params={};r.names.forEach((n,i)=>params[n]=decodeURIComponent(m[i+1]));return{handler:r.handler,params};}}return null}}
module.exports=Router;
