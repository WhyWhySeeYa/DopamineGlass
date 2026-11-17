'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parseOpenStep}=require('./helpers/openstep.cjs');
const {prepare,serialize}=require('../scripts/prepare-glass-app-project.cjs');
const root=path.resolve(__dirname,'..');
test('disposable App project preserves tracked source, trims core targets, redirects only existing original binaries',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'glass-app-project-'));
 try {
 const source=fs.readFileSync(path.join(root,'Application/Dopamine.xcodeproj/project.pbxproj'),'utf8');
 const original=parseOpenStep(source).value;
 const target=Object.values(original.objects).find(o=>o.isa==='PBXNativeTarget'&&o.name==='Dopamine');
 for(const phaseID of target.buildPhases) for(const buildID of original.objects[phaseID].files||[]){
 const r=original.objects[original.objects[buildID].fileRef];if(!r)continue;
 const base=path.basename(r.path||'');
 if(base.endsWith('.framework')&&r.sourceTree==='BUILT_PRODUCTS_DIR')fs.mkdirSync(path.join(temp,'official/Payload/Dopamine.app/Frameworks',base),{recursive:true});
 if(/^(lib(jailbreak|choma|xpf)\.dylib|basebin\.(tar|tc)|.*\.deb|bootstrap_.*\.tar\.zst)$/.test(base)) {const p=path.join(temp,'official/Payload/Dopamine.app',base);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'original');}
 }
 const output=prepare(root,temp),p=parseOpenStep(fs.readFileSync(path.join(output,'project.pbxproj'),'utf8')).value;
 const actual=Object.values(p.objects).find(o=>o.isa==='PBXNativeTarget'&&o.name==='Dopamine');
 assert.deepEqual(actual.dependencies,[]);
 assert.equal(Object.values(p.objects).filter(o=>o.isa==='PBXNativeTarget').length,1);
 assert.equal(Object.values(p.objects).filter(o=>['PBXTargetDependency','PBXContainerItemProxy'].includes(o.isa)).length,0);
 assert.equal(p.objects[p.rootObject].targets.length,1);
 const sources=t=>t.buildPhases.filter(id=>original.objects[id].isa==='PBXSourcesBuildPhase').map(id=>original.objects[id].files);
 assert.deepEqual(sources(actual),sources(target));
 assert.ok(actual.buildPhases.every(id=>p.objects[id].isa!=='PBXCopyFilesBuildPhase'));
 assert.equal(fs.readFileSync(path.join(root,'Application/Dopamine.xcodeproj/project.pbxproj'),'utf8'),source);
 const packageRef=Object.values(p.objects).find(o=>o.isa==='XCRemoteSwiftPackageReference');
 assert.equal(packageRef.requirement.kind,'revision');
 assert.equal(packageRef.requirement.revision,'f8745da6ff1ad1e7bab384bd1f9d742439278e99');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('OpenStep serializer roundtrips paths, escapes and empty dependency arrays',()=>{
 const x={path:'G:/test theme/"file"',arr:[],settings:{'$(inherited)':['a','b']}};
 assert.deepEqual(parseOpenStep(serialize(x)).value,x);
});
test('declaration-only header manifest has fixed commit and SHA256 for every header',()=>{
 const pins=JSON.parse(fs.readFileSync(path.join(root,'scripts/glass-header-pins.json'),'utf8'));
 assert.equal(pins.length,2);
 for(const p of pins){assert.match(p.commit,/^[a-f0-9]{40}$/);assert.ok(p.headers.length);for(const h of p.headers){assert.match(h.sha256,/^[a-f0-9]{64}$/);assert.ok(h.path.startsWith('src/')&&!h.path.includes('..'));}}
 assert.equal(pins.find(p=>p.name==='xpf').commit,'9e12b8faa7444f6fe7f699aec6b6c96d151455d3');
});
