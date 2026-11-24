'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const test = require('node:test');
const review = require('../scripts/supporter-key-review.cjs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root,'Application/Dopamine/UI/DOSupporterLicense.h'),'utf8');
function definition(name) {
  const match = new RegExp('^static inline [^{;]+\\b'+name+'\\([^;]*?\\)\\s*\\{','m').exec(source);
  assert.ok(match,name);
  const masked=source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|@?"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
    value=>value.replace(/[^\n]/g,' '));
  let depth=1;
  for(let i=match.index+match[0].length;i<source.length;i++) {
    if(masked[i]==='{')depth++;
    if(masked[i]==='}'&&--depth===0)return source.slice(match.index,i+1);
  }
  assert.fail('Unclosed '+name);
}
test('model reporting rejects OS names and retains target hardware and signed-install adapters',()=>{
  assert.match(source,/#import <sys\/sysctl.h>/);
  const model=definition('DORHSupporterProofModel');
  assert.ok(model.indexOf('MarketingProductName')<model.indexOf('ProductType'));
  assert.ok(model.indexOf('ProductType')<model.indexOf('sysctlbyname'));
  assert.match(model,/length > 1 && length <= sizeof\(machine\) && machine\[length - 1\] == '\\0'/);
  for(const name of ['DORHSupporterReadHardwareECIDDirect','DORHSupporterReadHardwareECID','DORHSupporterRetryPersistentAccess'])assert.ok(definition(name));
  const proof=definition('DORHSupporterCreateRHP1Proof');
  assert.ok(proof.indexOf('device_model')<proof.indexOf('DORHSupporterSignWithDeviceKey('));
  assert.match(proof,/includeDeviceInfo \? 2 : 1/);
  assert.match(proof,/return proofData;\s*\}$/);
});

test('native production RHP1 generator interoperates with issuer v1/v2 and signs metadata',{
  skip:process.platform!=='darwin'?'Requires macOS Foundation/Security; hardware and key storage are doubled, production proof generation and crypto execute.':false,
},()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rh-proof-info-'));
  try {
    const constants=source.slice(source.indexOf('static NSString * const DORHSupporterRHC1Audience'),source.search(/static inline NSString \*\s*DORHSupporterSHA256UpperHex/));
    assert.ok(constants.includes('DORHSupporterRHP1MaximumWireBytes'));
    const helpers=['DORHSupporterSHA256UpperHex','DORHSupporterIsUppercaseHexString','DORHSupporterEncodeBase64URL',
      'DORHSupporterCopyDevicePublicKeyData','DORHSupporterDeviceKeyFingerprint','DORHSupporterSignWithDeviceKey','DORHSupporterVerifyDeviceKeySignature'];
    const harness=`#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>
#import <sys/sysctl.h>
static NSString *scenario;
static NSString * const DORHSupporterDeviceKeyTag = @"TEST-ONLY";
static CFPropertyListRef MGCopyAnswer(CFStringRef key) {
  BOOL marketing=[(__bridge NSString *)key isEqual:@"MarketingProductName"];
  id value=nil;
  if ([scenario isEqual:@"marketing"]) value=marketing?@"iPhone 14 Pro Max":@"iPhone15,3";
  else if ([scenario isEqual:@"product"]) value=marketing?@"iOS":@"iPhone15,3";
  else if ([scenario isEqual:@"ipad"]) value=marketing?@"iPadOS":@"iPad13,4";
  else if ([scenario isEqual:@"invalid"]) value=marketing?@42:@"invalid/model";
  else if ([scenario isEqual:@"newline"]) value=marketing?@"iPhone 14\\n":nil;
  return value?CFRetain((__bridge CFTypeRef)value):NULL;
}
static int TestSysctl(const char *name, void *out, size_t *length, void *unused, size_t size) {
  if(strcmp(name,"hw.machine")) abort();
  if([scenario isEqual:@"unknown"])return -1;
  if([scenario isEqual:@"unterminated"]) { memset(out,'A',*length); return 0; }
  if([scenario isEqual:@"oversized"]) { *length=65;return 0; }
  if([scenario isEqual:@"empty"]) { *length=0;return 0; }
  const char *model=[scenario isEqual:@"invalid"]?"not-a-device":"iPhone15,3";
  strcpy(out,model);*length=strlen(model)+1;return 0;
}
#define sysctlbyname TestSysctl
${definition('DORHSupporterProofModel')}
#undef sysctlbyname
@interface TestProcessInfo : NSObject
+ (instancetype)processInfo;
- (NSOperatingSystemVersion)operatingSystemVersion;
@end
@implementation TestProcessInfo
+ (instancetype)processInfo { return [self new]; }
- (NSOperatingSystemVersion)operatingSystemVersion {
  if([scenario isEqual:@"bad-os"])return (NSOperatingSystemVersion){0,0,0};
  if([scenario isEqual:@"zero-patch"])return (NSOperatingSystemVersion){16,5,0};
  return (NSOperatingSystemVersion){16,5,1};
}
@end
${constants}
${helpers.map(definition).join('\n')}
static inline NSDictionary *DORHSupporterHardwareIdentityProbe(void) {
  return @{@"available":@YES,@"algorithm":@"rh-hw-v1",@"hardware_hash":@"${'A'.repeat(64)}"};
}
static inline SecKeyRef DORHSupporterCopyOrCreateDevicePrivateKey(BOOL *created,NSString **stage,NSInteger *code) {
  if(created)*created=NO;if(stage)*stage=nil;if(code)*code=0;
  return SecKeyCreateRandomKey((__bridge CFDictionaryRef)@{(__bridge id)kSecAttrKeyType:(__bridge id)kSecAttrKeyTypeECSECPrimeRandom,(__bridge id)kSecAttrKeySizeInBits:@256},NULL);
}
${definition('DORHSupporterParseRHC1Challenge')}
#define NSProcessInfo TestProcessInfo
${definition('DORHSupporterCreateRHP1Proof')}
#undef NSProcessInfo
int main(int argc,char **argv) { @autoreleasepool {
  scenario=[NSString stringWithUTF8String:argv[1]];
  NSData *challenge=[[NSString stringWithUTF8String:argv[2]] dataUsingEncoding:NSUTF8StringEncoding];
  NSString *stage=nil;NSInteger code=0;
  NSData *proof=DORHSupporterCreateRHP1Proof(challenge,&stage,&code);
  if(!proof){fprintf(stderr,"%s %ld\\n",stage.UTF8String,(long)code);return 10;}
  puts([[NSString alloc]initWithData:proof encoding:NSUTF8StringEncoding].UTF8String);
  return 0;
} }
`;
    const file=path.join(directory,'proof.m'),binary=path.join(directory,'proof');
    fs.writeFileSync(file,harness);
    execFileSync('xcrun',['clang','-fobjc-arc','-Wno-deprecated-declarations','-framework','Foundation','-framework','Security',file,'-o',binary],{stdio:'pipe'});
    const now=Math.floor(Date.now()/1000);
    const challenge=JSON.stringify({type:'RHC1',version:1,challenge_id:'B'.repeat(32),nonce:'C'.repeat(64),issued_at:now-5,expires_at:now+295,audience:'com.dopaminerh.supporter.device-proof'});
    for(const [scenario,model] of [['marketing','iPhone 14 Pro Max'],['product','iPhone15,3'],['ipad','iPad13,4'],['sysctl','iPhone15,3'],['newline','iPhone15,3'],['zero-patch','iPhone15,3'],['invalid',null],['unknown',null],['unterminated',null],['oversized',null],['empty',null],['bad-os',null]]) {
      const wire=execFileSync(binary,[scenario,challenge],{encoding:'utf8'}).trim();
      const proof=review.verifyProof(wire,challenge).proof;
      assert.equal(proof.version,model?2:1,scenario);
      assert.equal(proof.device_model,model||undefined,scenario);
      if(model) {
        assert.equal(proof.os_version,scenario==='zero-patch'?'16.5':'16.5.1');
        assert.throws(()=>review.verifyProof(wire.replace(model,'iPhone99,9'),challenge),/invalid-device-proof-signature/);
        assert.throws(()=>review.verifyProof(wire.replace(proof.os_version,'16.6.1'),challenge),/invalid-device-proof-signature/);
      }
    }
    assert.throws(()=>execFileSync(binary,['product',challenge+' '],{stdio:'pipe'}));
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
