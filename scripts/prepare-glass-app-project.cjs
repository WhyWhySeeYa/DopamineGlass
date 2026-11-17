'use strict';
// Disposable App-only project; never edits upstream BaseBin, gitlinks or original project.
const fs = require('node:fs');
const path = require('node:path');
const { parseOpenStep } = require('../tests/helpers/openstep.cjs');
function serialize(value, level = 0) {
  if (Array.isArray(value)) return '(' + value.map(v => serialize(v, level + 1)).join(', ') + ')';
  if (value && typeof value === 'object') return '{\n' + Object.entries(value).map(([k,v]) => '\t'.repeat(level+1) + JSON.stringify(k) + ' = ' + serialize(v, level+1) + ';').join('\n') + '\n' + '\t'.repeat(level) + '}';
  return JSON.stringify(String(value));
}
function prepare(root, work) {
  root = path.resolve(root); work = path.resolve(work);
  const appRoot = path.join(root, 'Application');
  const project = parseOpenStep(fs.readFileSync(path.join(appRoot,'Dopamine.xcodeproj/project.pbxproj'),'utf8')).value;
  const objects = project.objects;
  const [targetID, target] = Object.entries(objects).find(([,o])=>o.isa==='PBXNativeTarget' && o.name==='Dopamine');
  const main = objects[project.rootObject];
  const official = path.join(work,'official/Payload/Dopamine.app');
  main.targets = [targetID];
  main.projectDirPath = appRoot.replaceAll('\\','/');
  target.dependencies = [];
  // Xcode associates productReference with every native target object, even outside project.targets.
  // Drop obsolete target objects/proxies so linked frameworks are ordinary prebuilt file references.
  for (const [id, o] of Object.entries(objects)) {
    if ((o.isa === 'PBXNativeTarget' && id !== targetID) ||
        o.isa === 'PBXTargetDependency' || o.isa === 'PBXContainerItemProxy' ||
        o.isa === 'PBXFileSystemSynchronizedBuildFileExceptionSet') delete objects[id];
    if (o.isa === 'PBXFileSystemSynchronizedRootGroup') {
      o.isa='PBXGroup'; o.children=[];
      delete o.exceptions; delete o.explicitFileTypes; delete o.explicitFolders;
    }
  }
  if (main.attributes?.TargetAttributes)
    main.attributes.TargetAttributes = {[targetID]: main.attributes.TargetAttributes[targetID] || {}};
  // Preserve all App source/resource entries; remove core copy phases, assembled from original IPA later.
  target.buildPhases = target.buildPhases.filter(id => objects[id].isa !== 'PBXCopyFilesBuildPhase');
  const usedRefs = new Set(target.buildPhases.flatMap(id => objects[id].files || []).map(id => objects[id].fileRef).filter(Boolean));
  // Xcode 16.4 optimizes the baseline strrchr(constant, character) into unavailable memrchr.
  // Keep its original libc call for this source only, without touching bootstrap/version logic.
  for (const id of objects[target.buildPhases.find(id => objects[id].isa === 'PBXSourcesBuildPhase')].files) {
    const buildFile = objects[id];
    if (objects[buildFile.fileRef]?.path === 'DOBootstrapper.m') {
      buildFile.settings ||= {};
      buildFile.settings.COMPILER_FLAGS = ((buildFile.settings.COMPILER_FLAGS || '') + ' -fno-builtin-strrchr').trim();
    }
  }
  for (const [objectID, object] of Object.entries(objects)) {
    if(object.isa==='PBXBuildFile' && object.settings?.ATTRIBUTES)
      object.settings.ATTRIBUTES = object.settings.ATTRIBUTES.filter(a => a !== 'CodeSignOnCopy' && a !== 'RemoveHeadersOnCopy');
    if(object.isa==='PBXFileReference' && usedRefs.has(objectID)) {
      const basename = path.basename(object.path || '');
      if (object.sourceTree === 'DEVELOPER_DIR' && basename === 'IOKit.framework') {
        object.path = 'System/Library/Frameworks/IOKit.framework'; object.sourceTree = 'SDKROOT';
      }
      if ((object.sourceTree === 'BUILT_PRODUCTS_DIR' && basename.endsWith('.framework')) || /^lib(jailbreak|choma|xpf)\.dylib$/.test(basename) || /^(basebin\.(tar|tc)|.*\.deb|bootstrap_.*\.tar\.zst)$/.test(basename)) {
        const file = path.join(official, basename.endsWith('.framework') ? 'Frameworks' : '', basename);
        if (!fs.existsSync(file)) throw new Error('Official package missing build input: '+file);
        object.path = file.replaceAll('\\','/'); object.sourceTree = '<absolute>';
        if (object.explicitFileType) { object.lastKnownFileType=object.explicitFileType; delete object.explicitFileType; }
      }
    }
    if(object.isa==='XCRemoteSwiftPackageReference' && object.repositoryURL==='https://github.com/facebook/zstd.git')
      object.requirement = {kind:'revision', revision:'f8745da6ff1ad1e7bab384bd1f9d742439278e99'}; // v1.5.7, frontend-only
    if(object.isa==='XCBuildConfiguration') {
      const s=object.buildSettings;
      // Override on the disposable project only. No SDK headers copied into upstream sources.
      s.HEADER_SEARCH_PATHS = [path.join(work,'include').replaceAll('\\','/'), '$(inherited)'];
      s.LIBRARY_SEARCH_PATHS = [official.replaceAll('\\','/'),'$(PROJECT_DIR)/Dopamine/Dependencies','$(PROJECT_DIR)/Dopamine/Resources','$(inherited)'];
      s.FRAMEWORK_SEARCH_PATHS = [path.join(official,'Frameworks').replaceAll('\\','/'),'$(PROJECT_DIR)/Frameworks','$(inherited)'];
      s.CODE_SIGNING_ALLOWED='NO'; s.CODE_SIGNING_REQUIRED='NO';
      s.ARCHS='arm64'; s.ONLY_ACTIVE_ARCH='NO';
    }
  }
  const output=path.join(work,'GlassApp.xcodeproj');
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'project.pbxproj'),'// !$*UTF8*$!\n'+serialize(project)+'\n');
  return output;
}
if(require.main===module) console.log(prepare(path.resolve(__dirname,'..'), process.argv[2]));
module.exports={prepare,serialize};
