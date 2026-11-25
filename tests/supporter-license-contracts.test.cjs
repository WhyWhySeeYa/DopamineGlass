const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { verifyAppEntitlements } = require('../scripts/verify-app-entitlements.cjs');

const root = path.resolve(__dirname, '..');
const uiRoot = path.join(root, 'Application/Dopamine/UI');
const source = fs.readFileSync(
  path.join(uiRoot, 'DOSupporterLicense.h'),
  'utf8',
);
const licenseUI = fs.readFileSync(
  path.join(uiRoot, 'DOSupporterLicenseUI.h'),
  'utf8',
);
const home = fs.readFileSync(path.join(uiRoot, 'DOMainViewController.m'), 'utf8');
const theme = fs.readFileSync(path.join(uiRoot, 'DOCustomGlassView.m'), 'utf8');
const themeManager = fs.readFileSync(path.join(uiRoot, 'Themes/DOThemeManager.m'), 'utf8');
const settings = fs.readFileSync(
  path.join(uiRoot, 'Settings/DOSettingsController.m'),
  'utf8',
);
const credits = fs.readFileSync(
  path.join(uiRoot, 'Settings/DOCreditsViewController.m'),
  'utf8',
);
const creditsPlist = fs.readFileSync(
  path.join(uiRoot, 'Settings/Credits.plist'),
  'utf8',
);

function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing section: ${start}`);
  return source.slice(a, b);
}

function body(name) {
  const signature = new RegExp(
    String.raw`^static inline [^{;]+\b${name}\([^;]*?\)\s*\{`,
    'm',
  );
  const match = signature.exec(source);
  assert.ok(match, `Missing function definition: ${name}`);

  const start = match.index + match[0].length;
  let depth = 1;
  for (let index = start; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) {
      return source.slice(start, index);
    }
  }
  assert.fail(`Unclosed function body: ${name}`);
}

function objcMethod(sourceText, signature) {
  const start = sourceText.indexOf(signature);
  assert.ok(start >= 0, `Missing Objective-C method: ${signature}`);
  const opening = sourceText.indexOf('{', start + signature.length);
  assert.ok(opening >= 0, `Missing method body: ${signature}`);
  let depth = 0;
  for (let index = opening; index < sourceText.length; index++) {
    if (sourceText[index] === '{') depth++;
    if (sourceText[index] === '}' && --depth === 0)
      return sourceText.slice(opening + 1, index);
  }
  assert.fail(`Unclosed Objective-C method: ${signature}`);
}

test('hardware identity fallback reads only the same ECID and retains actionable failure stages', () => {
  const readECID = body('DORHSupporterReadHardwareECIDDirect');
  assert.ok(readECID.indexOf('MGCopyAnswer') < readECID.indexOf('IORegistryEntryFromPath'));
  assert.match(readECID, /IODeviceTree:\/chosen/);
  assert.match(readECID, /CFSTR\("unique-chip-id"\)/);
  assert.match(readECID, /CFDataGetLength\(data\) == sizeof\(ecid\)/);
  assert.match(readECID, /bytes\[i\]\) << \(i \* 8\)/);
  assert.match(readECID, /IOObjectRelease\(chosen\)/);
  assert.doesNotMatch(readECID, /NSLog|NSUserDefaults|writeToFile|identifierForVendor|SecItem/);
  const proof = body('DORHSupporterCreateRHP1Proof');
  assert.match(proof, /\*failureStage = hardware\[@"stage"\]/);
  assert.match(proof, /hardware\[@"error_code"\] integerValue/);
  assert.match(licenseUI, /hardware\[@"stage"\] \?: @"hardware-identity"/);
});

test('access adapters preserve RC9 license operations outside the persistence I/O adapter', () => {
  const tail = source.slice(source.indexOf('// Phase 2A Device Key'))
    .replace(/static inline NSString [*]DORHSupporterPersistentStatePath[(]void[)][\s\S]*?(?=static inline NSString [*]DORHSupporterPersistentString)/, '')
    .replace('*failureStage = hardware[@"stage"] ?: @"hardware-identity";', '*failureStage = @"hardware-identity";')
    .replace('*failureCode = hardware[@"error_code"] ? [hardware[@"error_code"] integerValue] : -1;', '*failureCode = -1;')
    .replace(/\r\n/g, '\n').trim();
  assert.equal(require('node:crypto').createHash('sha256').update(tail).digest('hex'),
    '0efc6bb6be06963d004fcda55a799168fc1d2970dab02562529901ea22542661');
});

test('native Foundation executes hardware identity fallback, canonical hashes and failure diagnostics', {
  skip: process.platform !== 'darwin' && 'Requires macOS Foundation; MobileGestalt and IOKit are test doubles, production ECID reader and hashing run unchanged.',
}, () => {
  const os = require('node:os');
  const crypto = require('node:crypto');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-hardware-'));
  const expectedHash = hex => crypto.createHash('sha256').update('DopamineRH-HW-v1|' + hex).digest('hex').toUpperCase();
  try {
    const production = section(source, 'static inline unsigned long long\nDORHSupporterReadHardwareECID', '// Phase 2A Device Key');
    const file = path.join(directory, 'main.m');
    fs.writeFileSync(file, `#import <Foundation/Foundation.h>
#import <CommonCrypto/CommonDigest.h>
#import <IOKit/IOKitLib.h>
#undef kIOMainPortDefault
#define kIOMainPortDefault 0
#define IORegistryEntryFromPath TestIORegistryEntryFromPath
#define IORegistryEntryCreateCFProperty TestIORegistryEntryCreateCFProperty
#define IOObjectRelease TestIOObjectRelease
static id gestaltAnswer, registryAnswer;
static BOOL registryNode = YES;
static NSUInteger registryReads, nodeReleases;
static BOOL installedThroughTrollStore = YES, jailbreakActive, allowRoot;
static BOOL rootScope, unsandboxedScope;
static NSUInteger rootAttempts, unsandboxedAttempts;
static id privilegedGestaltAnswer, privilegedRegistryAnswer;
@interface DOEnvironmentManager : NSObject
+ (instancetype)sharedManager;
- (BOOL)isJailbroken;
- (BOOL)isInstalledThroughTrollStore;
- (void)runAsRoot:(void (^)(void))block;
- (void)runUnsandboxed:(void (^)(void))block;
@end
@implementation DOEnvironmentManager
+ (instancetype)sharedManager {
  static DOEnvironmentManager *environment;
  if (!environment) environment = [DOEnvironmentManager new];
  return environment;
}
- (BOOL)isJailbroken { return jailbreakActive; }
- (BOOL)isInstalledThroughTrollStore { return installedThroughTrollStore; }
- (void)runAsRoot:(void (^)(void))block {
  rootAttempts++;
  if (!jailbreakActive || installedThroughTrollStore || rootScope) abort();
  if (!allowRoot) return;
  rootScope = YES;
  @try { block(); } @finally { rootScope = NO; }
}
- (void)runUnsandboxed:(void (^)(void))block {
  unsandboxedAttempts++;
  if (!rootScope || unsandboxedScope) abort();
  unsandboxedScope = YES;
  @try { block(); } @finally { unsandboxedScope = NO; }
}
@end
static CFPropertyListRef MGCopyAnswer(CFStringRef key) {
  if (![(__bridge NSString *)key isEqualToString:@"UniqueChipID"]) abort();
  id answer = rootScope && unsandboxedScope ? privilegedGestaltAnswer : gestaltAnswer;
  return answer ? CFRetain((__bridge CFTypeRef)answer) : NULL;
}
static io_registry_entry_t IORegistryEntryFromPath(unsigned int port, const char *path) {
  if (port != 0 || strcmp(path, "IODeviceTree:/chosen")) abort();
  registryReads++; return registryNode ? 42 : 0;
}
static CFTypeRef IORegistryEntryCreateCFProperty(io_registry_entry_t node, CFStringRef key, CFAllocatorRef allocator, unsigned int options) {
  if (node != 42 || options != 0 || ![(__bridge NSString *)key isEqualToString:@"unique-chip-id"]) abort();
  id answer = rootScope && unsandboxedScope ? privilegedRegistryAnswer : registryAnswer;
  return answer ? CFRetain((__bridge CFTypeRef)answer) : NULL;
}
static int IOObjectRelease(io_registry_entry_t node) { if (node != 42) abort(); nodeReleases++; return 0; }
${production}
#define CHECK(x) do { if (!(x)) { fprintf(stderr, "Hardware test failed at line %d\\n", __LINE__); abort(); } } while (0)
int main(void) { @autoreleasepool {
  unsigned char bytes[] = {0xEF, 0xCD, 0xAB, 0x89, 0x67, 0x45, 0x23, 0x01};
  NSData *valid = [NSData dataWithBytes:bytes length:8];
  NSString *expected = @"${expectedHash('0123456789ABCDEF')}";
  NSString *hex = [expected substringToIndex:32];
  NSMutableArray *groups = [NSMutableArray array];
  for (NSUInteger i = 0; i < hex.length; i += 4) [groups addObject:[hex substringWithRange:NSMakeRange(i, 4)]];
  NSString *expectedID = [@"D2-" stringByAppendingString:[groups componentsJoinedByString:@"-"]];
  gestaltAnswer = @0x0123456789ABCDEFULL;
  NSDictionary *hardware = DORHSupporterHardwareIdentityProbe();
  CHECK([hardware[@"hardware_hash"] isEqual:expected]);
  CHECK([hardware[@"source"] isEqual:@"mobilegestalt"] && registryReads == 0);
  // nil, wrong type, booleans, floating-point and zero all need a real ECID.
  registryAnswer = valid;
  for (id answer in @[NSNull.null, @"invalid", @YES, @1.5, @0]) {
    gestaltAnswer = answer == NSNull.null ? nil : answer;
    NSUInteger released = nodeReleases;
    hardware = DORHSupporterHardwareIdentityProbe();
    CHECK([hardware[@"available"] boolValue]);
    CHECK([hardware[@"hardware_hash"] isEqual:expected]);
    CHECK([hardware[@"hardware_id"] isEqual:expectedID]);
    CHECK([hardware[@"source"] isEqual:@"device-tree"]);
    CHECK(nodeReleases == released + 1);
  }
  gestaltAnswer = nil;
  unsigned char highBytes[] = {0x10, 0x32, 0x54, 0x76, 0x98, 0xBA, 0xDC, 0xFE};
  registryAnswer = [NSData dataWithBytes:highBytes length:8];
  CHECK([DORHSupporterHardwareIdentityProbe()[@"hardware_hash"] isEqual:@"${expectedHash('FEDCBA9876543210')}"]);
  gestaltAnswer = @0xFEDCBA9876543210ULL;
  CHECK([DORHSupporterHardwareIdentityProbe()[@"hardware_hash"] isEqual:@"${expectedHash('FEDCBA9876543210')}"]);
  gestaltAnswer = nil;
  for (id invalid in @[NSNull.null, @42, @"123", [NSMutableData dataWithLength:7], [NSMutableData dataWithLength:9], [NSMutableData dataWithLength:8]]) {
    registryAnswer = invalid == NSNull.null ? nil : invalid;
    hardware = DORHSupporterHardwareIdentityProbe();
    CHECK(![hardware[@"available"] boolValue]);
    CHECK([hardware[@"hardware_hash"] length] == 0 && [hardware[@"hardware_id"] length] == 0);
    CHECK([hardware[@"stage"] hasPrefix:@"hardware-identity/mg-missing/ioreg-"]);
    CHECK([hardware[@"error_code"] integerValue] <= -3);
  }
  registryNode = NO; registryAnswer = valid;
  hardware = DORHSupporterHardwareIdentityProbe();
  CHECK([hardware[@"stage"] isEqual:@"hardware-identity/mg-missing/ioreg-node"]);
  CHECK([hardware[@"error_code"] integerValue] == -2);
  CHECK(rootAttempts == 0 && unsandboxedAttempts == 0);
  // A signed App with ordinary access still uses RC9's original identity,
  // whether or not a jailbreak is active. No privilege change is necessary.
  installedThroughTrollStore = NO; registryNode = YES; registryAnswer = nil;
  gestaltAnswer = @0x0123456789ABCDEFULL;
  hardware = DORHSupporterHardwareIdentityProbe();
  CHECK([hardware[@"hardware_hash"] isEqual:expected]);
  CHECK(rootAttempts == 0);
  gestaltAnswer = nil;
  hardware = DORHSupporterHardwareIdentityProbe();
  CHECK(![hardware[@"available"] boolValue]);
  CHECK([hardware[@"stage"] isEqual:@"hardware-identity/signed-jailbreak/inactive"]);
  CHECK([hardware[@"error_code"] integerValue] == -8 && rootAttempts == 0);
  // Do not cache the failure: activating the existing upstream environment
  // allows the next attempt. Denied root access must still fail closed.
  jailbreakActive = YES;
  hardware = DORHSupporterHardwareIdentityProbe();
  CHECK(![hardware[@"available"] boolValue]);
  CHECK([hardware[@"stage"] isEqual:@"hardware-identity/signed-jailbreak/root-unavailable"]);
  CHECK([hardware[@"error_code"] integerValue] == -7);
  CHECK(rootAttempts == 1 && unsandboxedAttempts == 0);
  allowRoot = YES; privilegedRegistryAnswer = valid;
  hardware = DORHSupporterHardwareIdentityProbe();
  CHECK([hardware[@"hardware_hash"] isEqual:expected]);
  CHECK([hardware[@"hardware_id"] isEqual:expectedID]);
  CHECK([hardware[@"source"] isEqual:@"device-tree-jailbreak"]);
  CHECK(!rootScope && !unsandboxedScope);
  CHECK(rootAttempts == 2 && unsandboxedAttempts == 1);
  // Output pointers are optional and successful retries clear prior errors.
  NSString *readSource = @"stale", *readStage = @"stale"; NSInteger readCode = -99;
  CHECK(DORHSupporterReadHardwareECID(&readSource, &readStage, &readCode) == 0x0123456789ABCDEFULL);
  CHECK(readStage == nil && readCode == 0);
  CHECK(DORHSupporterReadHardwareECID(NULL, NULL, NULL) == 0x0123456789ABCDEFULL);
  privilegedGestaltAnswer = @0xFEDCBA9876543210ULL;
  hardware = DORHSupporterHardwareIdentityProbe();
  CHECK([hardware[@"hardware_hash"] isEqual:@"${expectedHash('FEDCBA9876543210')}"]);
  CHECK([hardware[@"source"] isEqual:@"mobilegestalt-jailbreak"]);
  CHECK(!rootScope && !unsandboxedScope);
  privilegedGestaltAnswer = nil; privilegedRegistryAnswer = nil;
  hardware = DORHSupporterHardwareIdentityProbe();
  CHECK(![hardware[@"available"] boolValue]);
  CHECK([hardware[@"hardware_hash"] length] == 0);
  CHECK([hardware[@"stage"] isEqual:@"hardware-identity/mg-missing/ioreg-property/signed-retry"]);
  CHECK([hardware[@"error_code"] integerValue] == -3);
  CHECK(!rootScope && !unsandboxedScope);
  NSUInteger attempts = rootAttempts; installedThroughTrollStore = YES;
  hardware = DORHSupporterHardwareIdentityProbe();
  CHECK(![hardware[@"available"] boolValue] && rootAttempts == attempts);
  CHECK([hardware[@"stage"] isEqual:@"hardware-identity/mg-missing/ioreg-property"]);
  return 0;
} }
`);
    const executable = path.join(directory, 'hardware-test');
    for (const [command, args] of [
      ['xcrun', ['clang', '-fobjc-arc', '-framework', 'Foundation', file, '-o', executable]],
      [executable, []],
    ]) {
      const result = spawnSync(command, args, { encoding: 'utf8' });
      assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('authorization actions use matching numbered labels and brief copied-proof feedback without changing activation copy', () => {
  const actionKeys = ['Supporter_Copy_Device_Code', 'Supporter_Bind_This_Device', 'Supporter_Paste_License'];
  const value = (text, key) => {
    const matches = [...text.matchAll(new RegExp(`^"${key}"\\s*=\\s*("(?:[^"\\\\]|\\\\.)*");`, 'gm'))];
    assert.equal(matches.length, 1, `Missing or duplicate ${key}`);
    return JSON.parse(matches[0][1]);
  };
  for (const locale of ['zh-Hans', 'zh-CN', 'en']) {
    const text = fs.readFileSync(path.join(root, `Application/Dopamine/${locale}.lproj/Localizable.strings`), 'utf8');
    const actions = actionKeys.map(key => value(text, key));
    actions.forEach((label, index) => assert.ok(label.startsWith(`${index + 1}. `)));
    if (locale !== 'en') {
      assert.deepEqual(actions, ['1. 复制设备码', '2. 生成证明码', '3. 粘贴授权码']);
      assert.equal(new Set(actions.map(label => [...label].length)).size, 1);
      assert.equal(value(text, 'Supporter_Device_Code_Copied'), '设备码已复制');
      assert.equal(value(text, 'Supporter_Device_Proof_Ready'), '证明已生成并复制');
      assert.equal(value(text, 'Supporter_Device_Code_Copied_Message'), '请粘贴发给作者。');
      assert.equal(value(text, 'Supporter_Device_Proof_Ready_Message'), '请粘贴发给作者。');
      assert.equal(value(text, 'Supporter_Activated'), '支持者授权已启用');
      assert.equal(value(text, 'Supporter_Activated_Message'), '授权已保存。立即应用以刷新界面。');
      assert.equal(value(text, 'Supporter_Apply_Now'), '立即应用');
    }
    assert.ok(!/^\d/.test(value(text, 'Supporter_Remove_License')));
    assert.ok(!/^\d/.test(value(text, 'Supporter_Advanced_Diagnostics')));
  }
  assert.ok(licenseUI.indexOf('UIPasteboard.generalPasteboard.string = deviceCode;') <
    licenseUI.indexOf('DOLocalizedString(@"Supporter_Device_Code_Copied")'));
  assert.ok(licenseUI.indexOf('UIPasteboard.generalPasteboard.string = proofText;') <
    licenseUI.indexOf('DOLocalizedString(@"Supporter_Device_Proof_Ready")'));
});

test('backup only copies a verified bound pair and can be restored by the existing importer', () => {
  const backup = body('DORHSupporterBoundActivationBackupText');
  const restore = body('DORHSupporterStoreActivationText');
  assert.ok(backup.indexOf('DORHSupporterLicenseTombstoned()') < backup.indexOf('DORHSupporterVerifyBoundLicense('));
  assert.match(backup, /DORHSupporterPersistentString\(DORHSupporterPersistentLicenseCodeKey\)/);
  assert.match(backup, /DORHSupporterPersistentString\(DORHSupporterBindingCertificateKey\)/);
  assert.match(backup, /!DORHSupporterVerifyBoundLicense\(license, certificate, NULL\)\) return nil/);
  assert.match(backup, /return \[NSString stringWithFormat:@"%@\\n%@", license, certificate\]/);
  assert.doesNotMatch(backup, /DORHSupporterWritePersistentState|DORHSupporterSetPersistentString/);
  assert.match(restore, /componentsSeparatedByCharactersInSet:NSCharacterSet\.whitespaceAndNewlineCharacterSet/);
  assert.match(restore, /tokens\.count == 2 && \[tokens\[0\] hasPrefix:@"RH1\."\] && \[tokens\[1\] hasPrefix:@"RHB1\."\]/);
  assert.match(licenseUI, /if \(\[info\[@"binding_status"\] isEqualToString:@"bound"\]\)\s*\{\s*\[alert addAction:[^\n]*Supporter_Backup_Bound_License/);
  assert.match(licenseUI, /setItems:@\[@\{@"public\.utf8-plain-text": backup\}\]\s*options:@\{UIPasteboardOptionLocalOnly: @YES\}/);
});

test('brief user guides preserve the app step numbers when existing users skip device-code submission', () => {
  const guides = ['03-发给用户-授权与设备绑定步骤.txt', '04-发给旧用户-补发授权步骤.txt']
    .map(name => fs.readFileSync(path.join(root, '授权流程说明', name), 'utf8'));
  assert.deepEqual([...guides[0].matchAll(/^(\d)\. /gm)].map(match => match[1]), ['1', '2', '3']);
  assert.deepEqual([...guides[1].matchAll(/^(\d)\. /gm)].map(match => match[1]), ['2', '3']);
  for (const guide of guides) {
    assert.ok(guide.includes('复制作者发来的验证文本'));
    assert.ok(guide.includes('2. 生成证明码'));
    assert.ok(guide.includes('3. 粘贴授权码'));
    assert.ok(guide.includes('已验证 · 已绑定本机'));
    assert.ok(guide.length < 400);
  }
  assert.ok(guides[1].includes('原记录和设备码未变'));
  assert.ok(guides[1].includes('旧授权不用删除'));
});

test('packaged entitlement verifier rejects missing, broad or mismatched keychain permissions', () => {
  const info = { CFBundleIdentifier: 'cn.zqbb.dopaRH' };
  const valid = {
    'application-identifier': info.CFBundleIdentifier,
    'keychain-access-groups': [info.CFBundleIdentifier],
    'platform-application': true,
    'com.apple.private.security.no-sandbox': true,
    'com.apple.private.MobileGestalt.AllowedProtectedKeys': ['UniqueChipID'],
  };
  assert.doesNotThrow(() => verifyAppEntitlements(valid, info));
  for (const key of Object.keys(valid)) {
    const missing = { ...valid };
    delete missing[key];
    assert.throws(() => verifyAppEntitlements(missing, info), key);
  }
  for (const groups of [[], ['*'], ['TROLLTROLL.*'], ['other.app'],
    [info.CFBundleIdentifier, 'com.apple.token'], info.CFBundleIdentifier]) {
    assert.throws(() => verifyAppEntitlements({ ...valid, 'keychain-access-groups': groups }, info));
  }
  assert.throws(() => verifyAppEntitlements({ ...valid, 'application-identifier': 'other.app' }, info));
  assert.throws(() => verifyAppEntitlements({ ...valid, 'com.apple.developer.team-identifier': 'FAKETEAM' }, info));
  assert.throws(() => verifyAppEntitlements(valid, { CFBundleIdentifier: 'other.app' }));
  for (const keys of [[], ['*'], ['SerialNumber'], ['UniqueChipID', 'SerialNumber'], 'UniqueChipID']) {
    assert.throws(() => verifyAppEntitlements({ ...valid,
      'com.apple.private.MobileGestalt.AllowedProtectedKeys': keys }, info));
  }
});

test('source entitlements pass the native plist parser and scoped keychain contract', {
  skip: process.platform !== 'darwin' && process.platform !== 'win32',
}, () => {
  const file = path.join(root, 'Application/Dopamine/Dopamine.entitlements');
  let result;
  if (process.platform === 'darwin') {
    result = spawnSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' });
  } else {
    // Use the native XML parser, not text matching, to preserve plist value types.
    result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
      $ErrorActionPreference = 'Stop'
      $plist = [xml](Get-Content -LiteralPath '${file.replace(/'/g, "''")}' -Raw)
      $values = @{}
      foreach ($key in $plist.plist.dict.SelectNodes('key')) {
        $value = $key.NextSibling
        switch ($value.LocalName) {
          'string' { $values[$key.InnerText] = $value.InnerText }
          'true' { $values[$key.InnerText] = $true }
          'false' { $values[$key.InnerText] = $false }
          'array' { $values[$key.InnerText] = @($value.SelectNodes('string') | ForEach-Object { $_.InnerText }) }
          default { throw 'Unexpected entitlement plist value type' }
        }
      }
      ConvertTo-Json -InputObject $values -Depth 10 -Compress
    `], { encoding: 'utf8' });
  }
  assert.equal(result.status, 0, result.stderr);
  verifyAppEntitlements(JSON.parse(result.stdout), { CFBundleIdentifier: 'cn.zqbb.dopaRH' });
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/main.yml'), 'utf8');
  assert.match(workflow, /unzip -p "\$tipa" Payload\/Dopamine\.app\/Dopamine/);
  assert.match(workflow, /ldid -e .*RootHide-Dopamine.* > app-entitlements\.plist/);
  assert.match(workflow, /node scripts\/verify-app-entitlements\.cjs/);
});

test('supporter state keeps stable legacy keys and an external removal tombstone', () => {
  for (const value of [
    '@"DORHSupporter.LicenseCode"',
    '@"/var/mobile/Library/Application Support/DopamineRH"',
    '@"supporter-state.plist"',
    '@"DeviceCode"',
    '@"LicenseCode"',
    '@"LicenseRemoved"',
  ]) {
    assert.ok(source.includes(value), `Missing compatibility key: ${value}`);
  }
});

test('native Foundation saves, reloads and removes RC9 state through signed-install access', {
  skip: process.platform !== 'darwin' && 'Requires macOS Foundation; file access restrictions are doubled, production persistence and activation/removal execute.',
}, () => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'rh-persistence-'));
  try {
    const harness = fs.readFileSync(path.join(root, 'tests/helpers/supporter-persistence-main.m'), 'utf8')
      .replace('__PERSISTENCE_SOURCE__', section(source, 'static inline NSString *DORHSupporterPersistentStatePath', 'static inline NSString *DORHSupporterEmbeddedDeviceCode'))
      .replace('__STORE_SOURCE__', section(source, 'static inline BOOL DORHSupporterStoreLicenseCode', 'static inline BOOL DORHSupporterRemoveLicense'))
      .replace('__REMOVE_SOURCE__', source.slice(source.indexOf('static inline BOOL DORHSupporterRemoveLicense')));
    const file = path.join(directory, 'main.m');
    const executable = path.join(directory, 'persistence-test');
    fs.writeFileSync(file, harness);
    for (const [command, args] of [
      ['xcrun', ['clang', '-fobjc-arc', '-framework', 'Foundation', file, '-o', executable]],
      [executable, [path.join(directory, 'state')]],
    ]) {
      const result = spawnSync(command, args, { encoding: 'utf8' });
      assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('invalid or wrong-device licenses are rejected before state mutation', () => {
  const store = body('DORHSupporterStoreLicenseCode');
  const verify = store.indexOf('DORHSupporterVerifyLicenseCode(');
  const reject = store.indexOf('if (!info)');
  const read = store.indexOf('DORHSupporterReadPersistentState()');
  assert.ok(verify >= 0 && reject > verify && read > reject);
  assert.match(store.slice(reject, read), /return NO;/);
});

test('license activation fails closed when external state cannot clear a removal tombstone', () => {
  const store = body('DORHSupporterStoreLicenseCode');
  const persist = store.indexOf('DORHSupporterWritePersistentState(state)');
  const failure = store.indexOf('if (!persisted)');
  const defaults = store.indexOf('setObject:trimmed');
  assert.ok(persist >= 0 && failure > persist && defaults > failure);
  assert.match(store.slice(failure, defaults), /Unable to persist supporter license/);
  assert.match(store.slice(failure, defaults), /return NO;/);
});

test('legacy device-code derivation stays independent of the fork bundle identifier', () => {
  const deviceCode = body('DORHSupporterDeviceCode');
  assert.match(deviceCode, /NSString \*bundleID = @"com\.opa334\.Dopamine-roothide";/);
  assert.doesNotMatch(deviceCode, /NSBundle\.mainBundle\.bundleIdentifier/);
});

test('signature verification precedes payload parsing and checks product, entitlement, and device', () => {
  const verify = body('DORHSupporterVerifyLicenseCodeForDevice');
  assert.ok(
    verify.indexOf('SecKeyVerifySignature(') <
      verify.indexOf('JSONObjectWithData:payload'),
  );
  assert.match(verify, /kSecKeyAlgorithmECDSASignatureMessageX962SHA256/);
  assert.match(verify, /isEqualToString:@"RH1"/);
  assert.match(verify, /isEqualToString:@"DopamineRH"/);
  assert.match(verify, /containsObject:@"custom_glass"/);
  assert.match(verify, /if \(!\[device isEqualToString:currentDeviceCode\]\)/);
});

test('removal only clears defaults and announces completion after persistent tombstone is confirmed', () => {
  const remove = body('DORHSupporterRemoveLicense');
  assert.match(remove, /removedState\[DORHSupporterPersistentLicenseRemovedKey\] = @YES;/);
  assert.match(
    remove,
    /if \(!DORHSupporterWritePersistentState\(removedState\) \|\|\s*!DORHSupporterLicenseTombstoned\(\)\)\s*\{\s*return NO;/,
  );
  const failClosed = remove.indexOf('return NO;');
  assert.ok(failClosed < remove.indexOf('removeObjectForKey:DORHSupporterLicenseDefaultsKey'));
  assert.ok(failClosed < remove.indexOf('postNotificationName:'));
  assert.doesNotMatch(remove, /removeItemAtPath:/);
  assert.match(remove, /return YES;/);
});

test('device-key diagnostics never delete existing keys or fall back to software or ephemeral keys', () => {
  const keyLookup = body('DORHSupporterCopyOrCreateDevicePrivateKey');
  assert.match(keyLookup, /SecItemCopyMatching\(/);
  assert.match(keyLookup, /kSecAttrTokenID[\s\S]*kSecAttrTokenIDSecureEnclave/);
  assert.match(keyLookup, /DORHSupporterDeviceKeyIsSecureEnclaveP256PrivateKey/);
  assert.match(keyLookup, /SecKeyCreateRandomKey\(/);
  assert.doesNotMatch(keyLookup, /SecItemDelete\(/);
  assert.doesNotMatch(keyLookup, /kSecAttrIsPermanent\s*:\s*@NO/);
  assert.doesNotMatch(keyLookup, /fallbackAttrs|fallbackPrivate|ephemeralAttrs/);
});

test('application source contains no issuer private-key material', () => {
  assert.doesNotMatch(source, /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/);
  assert.doesNotMatch(source, /DORHSupporterIssuerPrivateKey/);
  assert.match(source, /static NSString \* const publicKeyBase64/);
});

test('settings retains the supporter-license flow while Credits has no authorization entry', () => {
  assert.match(settings, /DORHPresentSupporterLicense\(self\)/);
  assert.doesNotMatch(credits, /DOSupporterLicenseUI|DORHPresentSupporterLicense|supporterLicensePressed/);
  assert.doesNotMatch(creditsPlist, /Supporter_Title|supporterLicensePressed|<string>supporter<\/string>/);
  assert.match(licenseUI, /DORHSupporterStoreActivationText/);
  assert.match(licenseUI, /DORHSupporterRemoveLicense/);
});

test('device diagnostics disclose persistent key creation and never expose identifiers', () => {
  assert.match(licenseUI, /Supporter_Diagnostics_Consent_Message/);
  assert.ok(
    licenseUI.indexOf('Supporter_Diagnostics_Consent_Message') <
      licenseUI.indexOf('DORHSupporterDeviceKeyProbe()'),
    'the persistent-key disclosure must be shown before key probing',
  );
  const diagnostics = licenseUI.slice(
    licenseUI.indexOf('static inline void DORHPresentSupporterDiagnostics'),
    licenseUI.indexOf('static inline void DORHPresentSupporterLicense'),
  );
  assert.match(diagnostics, /signature_self_test/);
  assert.match(diagnostics, /created/);
  assert.doesNotMatch(diagnostics, /hardware_id|key_fingerprint|UIPasteboard/);
  for (const locale of ['en', 'zh-Hans', 'zh-CN']) {
    const strings = fs.readFileSync(
      path.join(root, `Application/Dopamine/${locale}.lproj/Localizable.strings`),
      'utf8',
    );
    for (const key of [
      'Supporter_Diagnostics_Consent_Message',
      'Supporter_Diagnostics_Result_Format',
      'Supporter_Key_State_Created',
    ]) {
      assert.match(strings, new RegExp(`"${key}"\\s*=`), `${locale} missing ${key}`);
    }
  }
});

test('authorization limits the glass theme while standalone jailbreak and maintenance remain available', () => {
  const enabled = objcMethod(themeManager, '- (DOTheme*)enabledTheme');
  assert.match(enabled, /if \(DORHSupporterIsVerified\(\)\)\s*\{\s*DOTheme \*glass = \[self getThemeForKey:DOCustomGlassThemeKey\];\s*if \(glass\) return glass;\s*\}\s*return \[self getThemeForKey:DODefaultThemeKey\];/);
  assert.doesNotMatch(enabled, /DOPreferenceManager|preferenceValueForKey|setPreferenceValue/);
  assert.match(themeManager, /theme\.key isEqualToString:DOCustomGlassThemeKey.*!supporterVerified/s);

  for (const signature of [
    '- (void)presentCustomGlassUsernameEditor',
    '- (void)presentCustomGlassMottoEditor',
    '- (void)customGlassAvatarTapped:',
  ]) {
    assert.match(objcMethod(home, signature), /requireCustomGlassSupporterAuthorization/);
  }

  const focusGesture = objcMethod(home, '- (void)customGlassAvatarPanned:');
  assert.match(focusGesture, /requireCustomGlassSupporterAuthorization/);
  assert.match(focusGesture, /DOCustomGlassThemeSyncCommitChanges/);
  assert.ok(focusGesture.indexOf("requireCustomGlassSupporterAuthorization") < focusGesture.indexOf("DOCustomGlassThemeSyncCommitChanges"));

  const jailbreak = objcMethod(home, '- (void)startJailbreak');
  assert.doesNotMatch(jailbreak, /requireCustomGlassSupporterAuthorization|DORHSupporter/);
  assert.doesNotMatch(home, /self\.jailbreakBtn\.enabled = DORHSupporterIsVerified\(\)/);
  assert.doesNotMatch(home, /customGlassJailbreakDisabledOverlay/);
  const jailbreakAction = section(home, 'self.jailbreakBtn = [[DOJailbreakButton alloc]', 'self.jailbreakBtn.enabled =');
  assert.doesNotMatch(jailbreakAction, /requireCustomGlassSupporterAuthorization|DORHSupporter/);

  const themeEntry = home.slice(
    home.indexOf('UIAction *themeAction'),
    home.indexOf('DOCustomLiquidGlassView *themeCard'),
  );
  assert.match(themeEntry, /requireCustomGlassSupporterAuthorization/);

  const maintenanceActions = section(home, 'UIAction *respringAction', '[restartStack addArrangedSubview:');
  assert.match(maintenanceActions, /\[.* respring\]/);
  assert.match(maintenanceActions, /\[.* rebootUserspace\]/);
  assert.match(maintenanceActions, /\[.* reboot\]/);
  assert.doesNotMatch(maintenanceActions, /requireCustomGlassSupporterAuthorization|DORHSupporter/);

  for (const signature of [
    '- (void)presentCustomGlassBackgroundPicker',
    '- (void)glassAppearanceChanged:',
    '- (void)appearanceSliderChanged:',
    '- (void)wallpaperPlaybackRateChanged:',
    '- (void)applyAppearancePreviewAndPersist:',
    '- (void)restoreRecommendedAppearanceValues',
  ]) {
    assert.match(objcMethod(theme, signature), /requireCustomGlassSupporterAuthorization/);
  }
  assert.match(theme, /name:DORHSupporterLicenseDidChangeNotification/);
  assert.match(theme, /self\.supporterAuthorizationVerified = DORHSupporterIsVerified\(\)/);

  const renderer = objcMethod(theme, '- (void)reloadMaterial');
  const unauthorized = renderer.slice(renderer.indexOf('if (!supporterVerified)'), renderer.indexOf('CGFloat blurStrength'));
  assert.match(unauthorized, /setValue:@\[\] forKey:@"filters"/);
  assert.match(unauthorized, /removeFromSuperview/);
  assert.match(unauthorized, /neutralTintView\.alpha = 1\.0/);
  assert.match(unauthorized, /specular(?:Boost|Dark)?GradientLayer\.hidden = YES/);
  assert.doesNotMatch(unauthorized, /UIBlurEffect|UIVisualEffectView/);
  assert.match(renderer, /self\.specularGradientLayer\.hidden = NO/);
  assert.match(renderer, /self\.specularBoostGradientLayer\.hidden = NO/);
  assert.match(renderer, /self\.specularDarkGradientLayer\.hidden = NO/);
});

test('unlicensed users see the upstream home; authorization automatically enables glass', () => {
  const gate = fs.readFileSync(path.join(uiRoot, 'DOThemePresentation.h'), 'utf8');
  assert.match(gate, /DOUsesCustomGlassTheme\(void\)\s*\{\s*return DORHSupporterIsVerified\(\);\s*\}/);
  const load = objcMethod(home, '- (void)viewDidLoad');
  assert.match(load, /self\.customGlassHomeEnabled = DOUsesCustomGlassTheme\(\)/);
  assert.match(load, /if \(self\.customGlassHomeEnabled\)\s*\[self setupCustomGlassHome\];\s*else\s*\[self setupStockHome\]/);
  const stock = fs.readFileSync(path.join(uiRoot, 'DOStockHome.inc'), 'utf8');
  assert.match(stock, /DOActionMenuView \*actionView/);
  assert.match(stock, /systemVersionLabel/);
  assert.match(stock, /appBuildInfoLabel/);
  assert.match(stock, /appBuildTimeLabel/);
  assert.match(stock, /otherJailbreakActived\(false\)/);
  assert.doesNotMatch(stock, /DORHSupporter|DOCustomLiquidGlassView|customGlassAvatar/);
});

test('ordinary Settings and Credits exit before installing RC9 backgrounds, buttons or styling', () => {
  for (const page of [settings, credits]) {
    const load = objcMethod(page, '- (void)viewDidLoad');
    assert.match(load, /self\.customGlassPageEnabled = DOUsesCustomGlassTheme\(\)/);
    const guard = load.indexOf('if (!self.customGlassPageEnabled)');
    assert.ok(guard >= 0 && guard < load.indexOf('self.overrideUserInterfaceStyle'));
    assert.match(load.slice(guard, load.indexOf('self.overrideUserInterfaceStyle')), /return;/);
    assert.match(objcMethod(page, '- (BOOL)preferencesUsesNativeTableLayout'), /return self\.customGlassPageEnabled/);
  }
  assert.match(objcMethod(settings, '- (void)customGlassStyleCell:'), /if \(!self\.customGlassPageEnabled\)\s*return;/);
  assert.match(objcMethod(credits, '- (void)customGlassStyleContent:'), /if \(!self\.customGlassPageEnabled\)\s*return;/);
});

test('home presentation refresh does not replace an in-flight jailbreak or dismiss a license dialog', () => {
  const refresh = objcMethod(home, '- (BOOL)refreshHomePresentationIfNeeded');
  assert.match(refresh, /if \(self\.jailbreakBtn\.didExpand\)\s*return NO;/);
  assert.match(refresh, /self\.customGlassHomeEnabled == DOUsesCustomGlassTheme\(\)\) \{\s*self\.view\.hidden = NO;/);
  assert.ok(refresh.indexOf('return NO;') < refresh.indexOf('self.view.hidden = YES'));
  assert.match(refresh, /topViewController == self && !self\.presentedViewController/);
  assert.match(refresh, /!self\.homeReloadRequested/);
  assert.match(refresh, /\[self stopUptimeTimer\]/);
  assert.match(refresh, /\[DOSceneDelegate relaunch\]/);
  assert.match(objcMethod(home, '- (void)viewWillAppear:'), /refreshHomePresentationIfNeeded/);
  assert.match(objcMethod(home, '- (void)supporterLicenseDidChange:'), /refreshHomePresentationIfNeeded/);
  const nav = fs.readFileSync(path.join(uiRoot, 'DONavigationController.m'), 'utf8');
  assert.match(objcMethod(nav, '- (BOOL)isCustomGlassFullScreenViewController:'), /return DOUsesCustomGlassTheme\(\) &&/);
  assert.match(nav, /customGlassApplySharedBackgroundBlurIntensity:supporterVerified \? blur : 0\.0/);
});


test('native Foundation executes production theme selection across authorization and malformed preferences', {
  skip: process.platform !== 'darwin' && 'Requires macOS Foundation; license validity is a test double, selection methods are production.',
}, () => {
  const os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-theme-policy-'));
  try {
    const definitions = [
      '- (NSArray*)getAvailableThemeKeys', '- (NSArray*)getAvailableThemeNames',
      '- (DOTheme*)getThemeForKey:', '- (DOTheme*)enabledTheme',
    ].map(signature => signature.startsWith('- (DOTheme*)getThemeForKey:')
      ? '- (DOTheme*)getThemeForKey:(NSString*)key' : signature);
    const methods = definitions.map(signature => signature + ' {' + objcMethod(themeManager, signature) + '}').join('\n');
    const gate = fs.readFileSync(path.join(uiRoot, 'DOThemePresentation.h'), 'utf8')
      .replace(/^#(?:pragma|import).*$/gm, '');
    const constants = themeManager.match(/^static NSString \* const .*$/gm).join('\n');
    const file = path.join(directory, 'main.m');
    fs.writeFileSync(file, `#import <Foundation/Foundation.h>
static BOOL authorized;
static BOOL DORHSupporterIsVerified(void) { return authorized; }
@interface DOPreferenceManager : NSObject
@property(nonatomic, strong) id value;
@property(nonatomic) NSUInteger writes;
+ (instancetype)sharedManager;
- (id)preferenceValueForKey:(NSString *)key;
- (void)setPreferenceValue:(id)value forKey:(NSString *)key;
@end
@implementation DOPreferenceManager
+ (instancetype)sharedManager { static id instance; if (!instance) instance = [self new]; return instance; }
- (id)preferenceValueForKey:(NSString *)key { return self.value; }
- (void)setPreferenceValue:(id)value forKey:(NSString *)key { self.value = value; self.writes++; }
@end
@interface DOTheme : NSObject
@property(nonatomic, strong) NSString *key;
@property(nonatomic, strong) NSString *name;
@end
@implementation DOTheme
@end
@interface DOThemeManager : NSObject
@property(nonatomic, strong) NSArray<DOTheme *> *themes;
- (NSArray *)getAvailableThemeKeys;
- (NSArray *)getAvailableThemeNames;
- (DOTheme *)getThemeForKey:(NSString *)key;
- (DOTheme *)enabledTheme;
@end
${constants}
@implementation DOThemeManager
${methods}
@end
${gate}
#define CHECK(x) do { if (!(x)) abort(); } while (0)
int main(void) { @autoreleasepool {
  DOThemeManager *manager = [DOThemeManager new];
  NSMutableArray *themes = [NSMutableArray array];
  for (NSString *key in @[@"default", @"custom_glass"]) {
    DOTheme *theme = [DOTheme new]; theme.key = key; theme.name = key; [themes addObject:theme];
  }
  manager.themes = themes;
  DOPreferenceManager *preferences = [DOPreferenceManager sharedManager];
  for (NSNumber *state in @[@NO, @YES]) {
    authorized = state.boolValue;
    for (id selected in @[NSNull.null, @"default", @"blue", @"purple", @"red", @"ellekit", @"custom_glass", @"missing", @42]) {
      preferences.value = selected == NSNull.null ? nil : selected;
      preferences.writes = 0;
      NSString *expected = authorized ? @"custom_glass" : @"default";
      CHECK([[manager enabledTheme].key isEqualToString:expected]);
      CHECK([[manager getAvailableThemeKeys] containsObject:@"custom_glass"] == authorized);
      CHECK([[manager getAvailableThemeKeys] isEqual:[manager getAvailableThemeNames]]);
      CHECK(preferences.writes == 0);
      CHECK(DOUsesCustomGlassTheme() == authorized);
    }
  }
  authorized = YES; preferences.value = @"custom_glass";
  CHECK([[manager enabledTheme].key isEqualToString:@"custom_glass"]);
  authorized = NO;
  CHECK([[manager enabledTheme].key isEqualToString:@"default"]);
  CHECK([preferences.value isEqual:@"custom_glass"]);
  authorized = YES;
  CHECK([[manager enabledTheme].key isEqualToString:@"custom_glass"]);
  CHECK(DOUsesCustomGlassTheme());
  return 0;
} }
`);
    for (const [command, args] of [
      ['xcrun', ['clang', '-fobjc-arc', '-framework', 'Foundation', file, '-o', path.join(directory, 'theme-test')]],
      [path.join(directory, 'theme-test'), []],
    ]) {
      const result = spawnSync(command, args, { encoding: 'utf8' });
      assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
    }
  } finally {
    assert.equal(path.dirname(directory), path.resolve(require('node:os').tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
