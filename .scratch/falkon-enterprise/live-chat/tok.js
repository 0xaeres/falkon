const fs=require('fs');let i=0,o=0,n=0;
for(const d of process.argv.slice(2))for(const f of fs.readdirSync(d).filter(x=>x.endsWith('.sse'))){const m=fs.readFileSync(d+'/'+f,'utf8').match(/"messageMetadata":(\{[^}]*\})/);if(m){const j=JSON.parse(m[1]);i+=j.totalInputTokens||0;o+=j.totalOutputTokens||0;n++}}
console.log('runs',n,'input',i,'output',o,'est $ at 0.30/1.00 per M:',(i*0.3/1e6+o*1.0/1e6).toFixed(2));
