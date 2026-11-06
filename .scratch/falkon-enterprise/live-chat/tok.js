const fs=require('fs');let i=0,o=0,n=0;
for(const d of process.argv.slice(2))for(const f of fs.readdirSync(d).filter(x=>x.endsWith('.sse'))){
  const line=fs.readFileSync(d+'/'+f,'utf8').split('\n').find(l=>l.startsWith('data: ')&&l.includes('"message-metadata"'));
  if(!line)continue;
  const j=JSON.parse(line.slice(6)).messageMetadata;i+=j.totalInputTokens||0;o+=j.totalOutputTokens||0;n++;
  if(j.steps)console.log(f,'in/step',j.steps.map(s=>s.in).join(','),'cached',j.totalCachedInputTokens,'step-1 share of input',(100*j.steps[0].in/Math.max(1,j.totalInputTokens)).toFixed(0)+'%');
}
console.log('runs',n,'input',i,'output',o,'est $ at 0.30/1.00 per M:',(i*0.3/1e6+o*1.0/1e6).toFixed(2));
