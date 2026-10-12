import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checkVersionPair} from './corpus-version-mapping.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
  const title='The Example Powers Bill, 2024',key='bill:2024:12';
  const make=(role,id)=>{const text=`Bill No. 12 of 2024 ${title} ${role==='as_introduced'?'AS INTRODUCED':'AS PASSED BY BOTH HOUSES'}\n`+'The authority shall exercise these statutory powers. '.repeat(100);
    return {source_key:id,title,text,content_sha256:sha(text),n_chars:[...text].length,file_url:`https://sansad.in/getFile/BillsTexts/LSBillTexts/${id}.pdf`,links:[{document_key:key,bill_number:'12',bill_year:2024,house:'Lok Sabha',role}]};};
  const source=make('as_introduced','source'),download=make('as_passed_both_houses','download');return {source,download,candidate:{...source,document_keys:[key]}};
}
test('two independently proven versions keep the source citation URL',()=>{const f=fixture();const p=checkVersionPair(f.candidate,f.source,f.download,f.source.text,f.download.text);assert.equal(p.source.file_url,f.source.file_url);assert.equal(p.download.file_url,f.download.file_url);assert.equal(p.document_key,'bill:2024:12');});
for(const [name,mutate] of [
  ['wrong key',f=>f.download.links[0].document_key='bill:2023:12'],
  ['wrong year',f=>f.download.links[0].bill_year=2023],
  ['wrong house',f=>f.download.links[0].house='Rajya Sabha'],
  ['wrong title',f=>f.download.title='Other Powers Bill'],
  ['same role',f=>f.download.links[0].role='as_introduced'],
  ['gazette',f=>f.download.links[0].role='gazette_notification'],
  ['ambiguous pack identity',f=>f.download.links.push({...f.download.links[0],document_key:'bill:2024:99'})],
  ['changed source URL',f=>f.source.file_url=f.download.file_url],
  ['wrong original text hash',f=>f.download.content_sha256=sha('other')],
])test(name+' is held',()=>{const f=fixture();mutate(f);assert.throws(()=>checkVersionPair(f.candidate,f.source,f.download,f.source.text,f.download.text));});
test('body disagreement in either PDF is held',()=>{for(const side of ['source','download']){const f=fixture();const text=f[side].text.split('\n')[0]+'\n'+'Unrelated provisions. '.repeat(200);assert.throws(()=>checkVersionPair(f.candidate,f.source,f.download,side==='source'?text:f.source.text,side==='download'?text:f.download.text),/disagreement/);}});
