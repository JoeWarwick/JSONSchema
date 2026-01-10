const fs = require('fs');
const s = fs.readFileSync('app/components/graphical-schema-editor.tsx','utf8');
const pairs = {'(':')','{':'}','[':']'};
const opens = new Set(Object.keys(pairs));
const closes = new Set(Object.values(pairs));
const stack = [];
for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  if (opens.has(ch)) stack.push({ch,pos:i+1});
  else if (closes.has(ch)){
    if (!stack.length){ console.log('Unmatched close',ch,'at',i+1); process.exit(0); }
    const last = stack.pop();
    if (pairs[last.ch] !== ch){ console.log('Mismatched', last.ch, 'at', last.pos, 'closed by', ch, 'at', i+1);
      // show context around close
      const lines = s.split('\n');
      let closeLine = 0, cum = 0;
      for (let j=0;j<lines.length;j++){ cum += lines[j].length+1; if (cum>=i+1){ closeLine = j+1; break; } }
      const start = Math.max(1, closeLine-10);
      const end = Math.min(lines.length, closeLine+10);
      console.log('Showing lines',start,'to',end);
      for (let k=start;k<=end;k++) console.log((k+'').padStart(4),'|',lines[k-1]);
      process.exit(0);
    }
  }
}
if (stack.length) console.log('Unclosed at end, first unclosed',stack[stack.length-1]);
else console.log('All balanced');
