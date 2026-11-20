'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { parseOpenStep } = require('../tests/helpers/openstep.cjs');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/rc9-port-manifest.json'), 'utf8'));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const git = (...args) => execFileSync('git', ['-c', 'safe.directory=' + root, '-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const migration = JSON.parse(read('docs/rc9-feature-migration.json'));
const original = file => git('show', manifest.upstream.commit + ':' + file);
const normalize = text => text.replace(/\r\n/g, '\n').trim();
const mainPath = 'Application/Dopamine/UI/DOMainViewController.m';
const settingsPath = 'Application/Dopamine/UI/Settings/DOSettingsController.m';
const projectPath = 'Application/Dopamine.xcodeproj/project.pbxproj';

// Mask comments and literals before balancing method bodies; a semicolon
// before the opening brace identifies a declaration, not an implementation.
function method(text, signature) {
  const masked = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|@?"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    value => value.replace(/[^\n]/g, ' '));
  let position = -1;
  while ((position = text.indexOf(signature, position + 1)) >= 0) {
    const opening = masked.indexOf('{', position);
    const semicolon = masked.indexOf(';', position);
    if (opening < 0 || (semicolon >= 0 && semicolon < opening)) continue;
    let depth = 1;
    for (let i = opening + 1; i < masked.length; i++) {
      if (masked[i] === '{') depth++;
      if (masked[i] === '}' && --depth === 0) return text.slice(position, i + 1);
    }
  }
  throw new Error('Missing or unbalanced Objective-C method: ' + signature);
}

const checks = {
  'upstream baseline is an explicit RootHide source commit with revision 30 ancestry'() {
    assert.equal(git('rev-parse', manifest.upstream.commit + '^{commit}').trim(), manifest.upstream.commit);
    git('merge-base', '--is-ancestor', manifest.upstream.rootHideAncestor, manifest.upstream.commit);
  },
  'jailbreak engine, exploit support, original resources and package managers remain upstream'() {
    const protectedPaths = manifest.contract.protectedPaths;
    const integrations = ['Application/Dopamine/Jailbreak/DOEnvironmentManager.h',
      'Application/Dopamine/Jailbreak/DOEnvironmentManager.m', 'BaseBin/roothidehooks/src/springboard.x'];
    const allowed = new Set([...integrations, ...Object.keys(migration.runtimeFiles)]);
    for (const changed of [git('diff', '--name-only', manifest.upstream.commit, '--', ...protectedPaths),
      git('ls-files', '--others', '--exclude-standard', '--', ...protectedPaths)])
      for (const file of changed.trim().split('\n').filter(Boolean)) assert.ok(allowed.has(file), 'Protected upstream path: ' + file);
    for (const [file, hash] of Object.entries(migration.runtimeFiles))
      assert.equal(crypto.createHash('sha256').update(read(file).replace(/\r\n/g, '\n')).digest('hex'), hash, file);
    let environment = read(integrations[1]).replace(/\r\n/g, '\n');
    for (const signature of ['- (NSDictionary *)batteryRecordConfiguration', '- (NSDictionary *)batteryRecordStatus',
      '- (BOOL)writeBatteryRecordValue:', '- (BOOL)saveBatteryRecordConfiguration:', '- (NSString *)sendBatteryRecordCommand:',
      '- (NSDictionary *)lowPowerScheduleConfiguration', '- (NSDictionary *)lowPowerScheduleStatus', '- (BOOL)saveLowPowerScheduleEnabled:'])
      environment = environment.replace(method(environment, signature) + '\n\n', '');
    for (const line of ['#import "../../../BaseBin/roothidehooks/src/RCLowPowerSchedule.h"',
      '#import "../../../BaseBin/roothidehooks/src/RCBatteryRecord.h"', '#import <notify.h>', '#import <errno.h>'])
      environment = environment.replace(line + '\n', '');
    assert.equal(normalize(environment), normalize(original(integrations[1])), 'Existing environment manager stays exact');
    const header = read(integrations[0]).replace(/\r\n/g, '\n').replace(/^- \(NSDictionary \*\)batteryRecordConfiguration;[\s\S]*?endMinute:\(NSInteger\)endMinute error:\(NSError \*\*\)error;\n/m, '');
    assert.equal(normalize(header), normalize(original(integrations[0])), 'Existing environment header stays exact');
    const springboard = read(integrations[2]).replace(/\r\n/g, '\n').replace(/^\textern void rc(?:LowPowerSchedule|BatteryRecord)Start\(void\);\n|^\trc(?:LowPowerSchedule|BatteryRecord)Start\(\);\n/gm, '');
    assert.equal(normalize(springboard), normalize(original(integrations[2])), 'Only two sbInit startups may be added');
  },
  'upstream jailbreak execution and title remain exact and cannot depend on theme authorization'() {
    const home = read(mainPath);
    const base = original(mainPath);
    for (const signature of ['- (void)startJailbreak', '- (NSString *)jailbreakButtonTitle'])
      assert.equal(normalize(method(home, signature)), normalize(method(base, signature)), signature);
    const state = method(home, '- (void)refreshCustomGlassButtonState');
    assert.doesNotMatch(state, /DORHSupporter|requireCustomGlassSupporterAuthorization/);
    const clickStart = home.indexOf('self.jailbreakBtn = [[DOJailbreakButton alloc]');
    const click = home.slice(clickStart, home.indexOf('self.jailbreakBtn.enabled =', clickStart));
    assert.match(click, /otherJailbreakActived\(false\)/);
    assert.doesNotMatch(click, /DORHSupporter|requireCustomGlassSupporterAuthorization/);
    assert.doesNotMatch(home, /customGlassJailbreakDisabledOverlay/);
  },
  'stock home helpers remain baseline-exact apart from explicit lifecycle and selector adapters'() {
    const base = original(mainPath);
    const stock = read('Application/Dopamine/UI/DOStockHome.inc');
    const entries = [
      ['-(void)setupStack', 'setupStack', 'setupStockHome'],
      ['- (void)viewDidLayoutSubviews', 'viewDidLayoutSubviews', 'layoutStockHome'],
      ['- (NSString *)systemUptimeDescription', 'systemUptimeDescription', 'stockSystemUptimeDescription'],
      ['- (NSString *)appBuildTimeDescription', 'appBuildTimeDescription', 'appBuildTimeDescription'],
      ['- (UILabel *)addInformationRowToHeader:', 'addInformationRowToHeader', 'addInformationRowToHeader'],
      ['- (void)refreshSystemInformation', 'refreshSystemInformation', 'refreshStockSystemInformation'],
      ['- (void)refreshSystemUptime', 'refreshSystemUptime', 'refreshStockSystemUptime'],
      ['- (void)resumeSystemInformationUpdates', 'resumeSystemInformationUpdates', 'resumeStockSystemInformationUpdates'],
      ['-(void)setupUpdateAvailable:', 'setupUpdateAvailable', 'setupStockUpdateAvailable'],
    ];
    for (const [signature, oldName, newName] of entries) {
      let expected = method(base, signature);
      for (const [, a, b] of entries.filter(([, a, b]) => a !== b && a !== 'setupUpdateAvailable'))
        expected = expected.replace(new RegExp('\\b' + a + '\\b', 'g'), b);
      if (oldName === 'setupUpdateAvailable')
        expected = expected.replace('-(void)setupUpdateAvailable:', '-(void)setupStockUpdateAvailable:');
      if (oldName === 'viewDidLayoutSubviews')
        expected = expected.replace('    [super layoutStockHome];\n', '');
      if (oldName === 'setupStack')
        expected = expected.replace(/^    \[NSNotificationCenter\.defaultCenter addObserver:self[^\n]+\n/gm, '');
      // The extracted file cleans inherited line-end whitespace for strict patch application.
      // No tokens, selectors or statements beyond the explicit adapters may change.
      assert.equal(normalize(method(stock, signature.replace(oldName, newName))), normalize(expected.replace(/[\t ]+$/gm, '')), signature);
    }
    const home = read(mainPath);
    assert.match(home, /#include "DOStockHome\.inc"/);
    assert.match(method(home, '- (void)viewDidLoad'), /if \(self\.customGlassHomeEnabled\)\s*\[self setupCustomGlassHome\];\s*else\s*\[self setupStockHome\]/);
    assert.match(method(home, '- (void)viewDidLayoutSubviews'), /if \(!self\.customGlassHomeEnabled\)\s*\[self layoutStockHome\]/);
  },
  'glass maintenance adapter honors the unchanged upstream void action signatures'() {
    const home = read(mainPath);
    const header = read('Application/Dopamine/Jailbreak/DOEnvironmentManager.h');
    for (const action of ['respring', 'rebootUserspace', 'reboot']) {
      assert.ok(header.includes('- (void)' + action + ';'), action);
      assert.ok(home.includes('[[DOEnvironmentManager sharedManager] ' + action + '];'), action);
      assert.ok(!home.includes('return [[DOEnvironmentManager sharedManager] ' + action + '];'), action);
    }
    const adapter = method(home, '- (void)performCustomGlassMaintenance:');
    assert.match(adapter, /void \(\^\)\(void\)/);
    assert.match(adapter, /operation\(\);/);
    assert.doesNotMatch(adapter, /int result|Maintenance_Failed/);
  },
  'settings retain upstream business methods, every original specifier and old theme/icon selection'() {
    const base = original(settingsPath);
    const current = read(settingsPath);
    const businessSignatures = [...base.matchAll(/^[-+]\s*\([^\n]+?\)[^\n]*\n?\s*\{/gm)]
      .map(match => match[0].replace(/\s*\{$/, ''))
      .filter(signature => !/viewDidLoad|viewWillAppear|specifiers/.test(signature));
    for (const signature of businessSignatures)
      assert.equal(normalize(method(current, signature)), normalize(method(base, signature)), signature);
    let specifiers = method(current, '- (id)specifiers');
    const start = specifiers.indexOf('        PSSpecifier *supporterSpecifier');
    const end = specifiers.indexOf('        PSSpecifier *themingGroupSpecifier', start);
    assert.ok(start >= 0 && end > start, 'Supporter entry must be independent of the support matrix');
    specifiers = specifiers.slice(0, start) + specifiers.slice(end);
    const scheduleStart = specifiers.indexOf('                    PSSpecifier *lowPowerSchedule =');
    const scheduleEnd = specifiers.indexOf('                    for (NSDictionary *tool', scheduleStart);
    assert.ok(scheduleStart >= 0 && scheduleEnd > scheduleStart);
    specifiers = specifiers.slice(0, scheduleStart) + specifiers.slice(scheduleEnd);
    assert.equal(normalize(specifiers), normalize(method(base, '- (id)specifiers')));
    assert.match(current, /setAlternateIconName:icon/);
    assert.match(current, /updateBootLogo/);
    assert.doesNotMatch(current, /customMountBusy|mountCustomDirectoryPressed/);
  },
  'original theme definitions and alternate app icons coexist with additive Custom Glass'() {
    const file = 'Application/Dopamine/UI/Themes/Themes.plist';
    const dictionaries = text => text.match(/<dict>[\s\S]*?<\/dict>/g) || [];
    const base = dictionaries(original(file));
    const current = dictionaries(read(file));
    assert.equal(current.length, base.length + 1);
    for (const entry of base) assert.ok(current.includes(entry), 'An original theme was modified or removed');
    assert.match(current[0], /<string>default<\/string>/);
    assert.match(current.at(-1), /<string>custom_glass<\/string>/);
    const nav = read('Application/Dopamine/UI/DONavigationController.m');
    assert.match(nav, /DOCustomGlassNavigationThemeKey = @"custom_glass"/);
    const main = read(mainPath);
    assert.match(main, /setPreferenceValue:@"custom_glass" forKey:@"theme"/);
    assert.doesNotMatch(main, /setAlternateIconName:nil/);
  },
  'all pre-existing Xcode targets, settings, dependencies and deployment limits are preserved'() {
    const base = parseOpenStep(original(projectPath)).value;
    const current = parseOpenStep(read(projectPath)).value;
    for (const [key, value] of Object.entries(base)) {
      if (key !== 'objects') assert.deepEqual(current[key], value, key);
    }
    const appendOnly = new Map([
      ['042479692B66916B0082581B', 'children'],
      ['042479672B66916B0082581B', 'children'], ['8C029F642B4E2E7D0071DE58', 'children'],
      ['8C7198112ABF0E82003C6658', 'files'], ['8C7198122ABF0E82003C6658', 'files'],
    ]);
    for (const [id, value] of Object.entries(base.objects)) {
      const actual = structuredClone(current.objects[id]);
      assert.ok(actual, 'Removed project object ' + id);
      if (appendOnly.has(id)) {
        const field = appendOnly.get(id);
        assert.deepEqual(actual[field].slice(0, value[field].length), value[field], id);
        for (const addition of actual[field].slice(value[field].length)) assert.ok(current.objects[addition], addition);
        actual[field] = value[field];
      }
      if (actual.isa === 'XCBuildConfiguration' && value.buildSettings.INFOPLIST_KEY_NSPhotoLibraryUsageDescription)
        actual.buildSettings.INFOPLIST_KEY_NSPhotoLibraryUsageDescription = value.buildSettings.INFOPLIST_KEY_NSPhotoLibraryUsageDescription;
      assert.deepEqual(actual, value, id + ': unrelated Xcode object changed');
    }
    const app = current.objects['8C7198142ABF0E82003C6658'];
    const sources = app.buildPhases.map(id => current.objects[id]).find(obj => obj.isa === 'PBXSourcesBuildPhase');
    const frameworks = app.buildPhases.map(id => current.objects[id]).find(obj => obj.isa === 'PBXFrameworksBuildPhase');
    const sourcePaths = sources.files.map(id => current.objects[current.objects[id].fileRef].path);
    assert.equal(sourcePaths.filter(name => name === 'DOCustomGlassView.m').length, 1);
    const frameworkPaths = frameworks.files.map(id => current.objects[current.objects[id].fileRef]?.path || '');
    for (const name of ['AVFoundation', 'Photos', 'PhotosUI', 'CoreImage', 'QuartzCore', 'Security'])
      assert.ok(frameworkPaths.some(file => file.endsWith('/' + name + '.framework')), name);
    for (const name of ['DOLowPowerScheduleController.m', 'DOBatteryRecordController.m']) {
      assert.equal(sourcePaths.filter(file => file === name).length, 1, name);
      assert.ok(fs.existsSync(path.join(root, 'Application/Dopamine/UI/Settings', name)));
    }
  },
  'RC9 imports and reviewed glass authorization adaptations match their recorded hashes'() {
    for (const [file, hash] of Object.entries(manifest.rc9.unchangedRuntimeFiles))
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'), hash, file);
    for (const [file, adaptation] of Object.entries(manifest.rc9.runtimeAdaptations)) {
      const adaptedHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
      assert.equal(adaptedHash, adaptation.adaptedSha256, file + ': reviewed adaptation hash');
      assert.match(adaptation.reason, /glass/i, file + ': adaptation scope');
    }
  },
  'upstream launch setup and newer-iOS Preferences guards survive glass integration'() {
    const startup = read('Application/Dopamine/main.m');
    const base = original('Application/Dopamine/main.m');
    const additions = ['#import "UI/DOCustomGlassThemeSync.h"\n', '#import "UI/DOCustomGlassMediaStore.h"\n',
      '        DOCustomGlassThemeSyncBootstrap();\n', '        DOCustomGlassMediaStoreScheduleOrphanCleanup();\n'];
    let stripped = startup;
    for (const line of additions) { assert.ok(stripped.includes(line), line); stripped = stripped.replace(line, ''); }
    assert.equal(normalize(stripped), normalize(base));
    const lists = 'Application/Dopamine/UI/Settings/PSLists/DOPSListController.m';
    assert.equal(normalize(method(read(lists), '+ (void)setupViewControllerStyle:')),
      normalize(method(original(lists), '+ (void)setupViewControllerStyle:')));
  },
  'UIKit harness expands production layout and material snippets without unresolved placeholders'() {
    const harness = require('../tests/helpers/preferences-ui-simulator.cjs').harnessSource();
    assert.doesNotMatch(harness, /PRODUCTION_[A-Z_]+/);
    for (const token of ['customGlassRefreshSectionBackdrops', 'updatePreferencesTableMask', 'DOCustomLiquidGlassView'])
      assert.ok(harness.includes(token), token);
  },
  'CI builds the current repository and checks signed package identity before uploading'() {
    const workflow = read('.github/workflows/main.yml');
    assert.doesNotMatch(workflow, /repository:\s*roothide\/Dopamine-roothide/);
    assert.match(workflow, /fetch-depth: 0/);
    assert.match(workflow, /node scripts\/run-rc9-tests\.cjs/);
    assert.match(workflow, /needs: \[uikit-layout, port-tests\]/);
    assert.match(workflow, /DORH_RUN_UIKIT_SIMULATOR: '1'/);
    assert.match(workflow, /node scripts\/verify-app-entitlements\.cjs/);
    assert.ok(workflow.indexOf('Verify packaged RC9 identity') < workflow.indexOf('- name: Upload Artifact'));
  },
  'existing localized strings are untouched and new authorization labels remain available'() {
    const entries = text => new Map([...text.matchAll(/^\s*("(?:\\.|[^"\\])*")\s*=\s*("(?:\\.|[^"\\])*")\s*;/gm)]
      .map(match => [JSON.parse(match[1]), match[2]]));
    for (const locale of ['en', 'zh-Hans', 'zh-CN']) {
      const file = 'Application/Dopamine/' + locale + '.lproj/Localizable.strings';
      const base = entries(original(file)), current = entries(read(file));
      for (const [key, value] of base) assert.equal(current.get(key), value, locale + ': ' + key);
      for (const key of ['Supporter_Title', 'Supporter_Copy_Device_Code', 'Supporter_Bind_This_Device',
        'Supporter_Paste_License', 'Button_Back', 'Home_Uptime_Format', 'Maintenance_Failed'])
        assert.ok(current.has(key), locale + ': ' + key);
    }
  },
};

function verify() {
  const passed = [];
  for (const [name, check] of Object.entries(checks)) { check(); passed.push(name); }
  return { upstream: manifest.upstream.commit, rc9: manifest.rc9.commit, checks: passed };
}
if (require.main === module) console.log(JSON.stringify(verify(), null, 2));
module.exports = { checks, verify, method };
