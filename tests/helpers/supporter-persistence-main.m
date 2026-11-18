// Production RC9 persistence is injected below; only access decisions and
// signature verification are doubled. Plists are actually written/read.
#import <Foundation/Foundation.h>
#import <objc/runtime.h>
static NSString *DORHSupporterPersistentDirectoryPath;
static NSString * const DORHSupporterPersistentStateFilename = @"supporter-state.plist";
static NSString * const DORHSupporterPersistentDeviceCodeKey = @"DeviceCode";
static NSString * const DORHSupporterPersistentLicenseCodeKey = @"LicenseCode";
static NSString * const DORHSupporterPersistentLicenseRemovedKey = @"LicenseRemoved";
static NSString * const DORHSupporterBindingCertificateKey = @"BindingCertificate";
static NSString * const DORHSupporterLicenseDefaultsKey = @"DORHSupporter.LicenseCode";
static NSString * const DORHSupporterLicenseDidChangeNotification = @"license-change";
static BOOL denyOrdinary, denyAllWrites, installedThroughTrollStore, jailbreakActive, allowRoot;
static BOOL rootScope, unsandboxedScope;
static NSUInteger rootAttempts, writes, invalidations;
static NSUserDefaults *testDefaults;
#define CHECK(x) do { if (!(x)) { fprintf(stderr, "Persistence test failed at line %d\n", __LINE__); abort(); } } while (0)
@interface TestDefaults : NSObject
+ (NSUserDefaults *)standardUserDefaults;
@end
@implementation TestDefaults
+ (NSUserDefaults *)standardUserDefaults { return testDefaults; }
@end
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
    CHECK(jailbreakActive && !installedThroughTrollStore && !rootScope);
    if (!allowRoot) return;
    rootScope = YES;
    @try { block(); } @finally { rootScope = NO; }
}
- (void)runUnsandboxed:(void (^)(void))block {
    CHECK(rootScope && !unsandboxedScope);
    unsandboxedScope = YES;
    @try { block(); } @finally { unsandboxedScope = NO; }
}
@end
@interface NSDictionary (TestAccess)
+ (id)test_dictionaryWithContentsOfFile:(NSString *)path;
@end
@implementation NSDictionary (TestAccess)
+ (id)test_dictionaryWithContentsOfFile:(NSString *)path {
    if ([path hasPrefix:DORHSupporterPersistentDirectoryPath] && denyOrdinary && !unsandboxedScope) return nil;
    return [self test_dictionaryWithContentsOfFile:path];
}
@end
@interface NSFileManager (TestAccess)
- (BOOL)test_createDirectoryAtPath:(NSString *)path withIntermediateDirectories:(BOOL)intermediates
                       attributes:(NSDictionary *)attributes error:(NSError **)error;
@end
@implementation NSFileManager (TestAccess)
- (BOOL)test_createDirectoryAtPath:(NSString *)path withIntermediateDirectories:(BOOL)intermediates
                       attributes:(NSDictionary *)attributes error:(NSError **)error {
    if ([path isEqual:DORHSupporterPersistentDirectoryPath]) {
        writes++;
        if (denyAllWrites || (denyOrdinary && !unsandboxedScope)) {
            if (error) *error = [NSError errorWithDomain:NSCocoaErrorDomain code:NSFileWriteNoPermissionError userInfo:nil];
            return NO;
        }
    }
    return [self test_createDirectoryAtPath:path withIntermediateDirectories:intermediates attributes:attributes error:error];
}
@end
static NSError *DORHSupporterLicenseError(NSInteger code, NSString *description) {
    return [NSError errorWithDomain:@"test" code:code userInfo:@{NSLocalizedDescriptionKey: description}];
}
static NSDictionary *DORHSupporterVerifyLicenseCode(NSString *license, NSError **error) {
    CHECK(!rootScope && !unsandboxedScope);
    return [license hasPrefix:@"valid"] ? @{@"sid": @"test"} : nil;
}
static void DORHSupporterInvalidateRenderAuthorization(void) {
    CHECK(!rootScope && !unsandboxedScope);
    invalidations++;
}
#define NSUserDefaults TestDefaults
__PERSISTENCE_SOURCE__
__STORE_SOURCE__
__REMOVE_SOURCE__
#undef NSUserDefaults
int main(int argc, char **argv) { @autoreleasepool {
    CHECK(argc == 2);
    DORHSupporterPersistentDirectoryPath = [NSString stringWithUTF8String:argv[1]];
    NSString *suite = [@"rc9-persistence-test." stringByAppendingString:NSUUID.UUID.UUIDString];
    testDefaults = [[NSUserDefaults alloc] initWithSuiteName:suite];
    method_exchangeImplementations(class_getClassMethod(NSDictionary.class, @selector(dictionaryWithContentsOfFile:)),
        class_getClassMethod(NSDictionary.class, @selector(test_dictionaryWithContentsOfFile:)));
    method_exchangeImplementations(class_getInstanceMethod(NSFileManager.class, @selector(createDirectoryAtPath:withIntermediateDirectories:attributes:error:)),
        class_getInstanceMethod(NSFileManager.class, @selector(test_createDirectoryAtPath:withIntermediateDirectories:attributes:error:)));
    __block NSUInteger notifications = 0;
    id observer = [NSNotificationCenter.defaultCenter addObserverForName:DORHSupporterLicenseDidChangeNotification
        object:nil queue:nil usingBlock:^(NSNotification *note) { CHECK(!rootScope && !unsandboxedScope); notifications++; }];
    NSDictionary *seed = @{@"DeviceCode": @"stable-code", @"LicenseRemoved": @YES, @"BindingRequired": @YES};
    CHECK(DORHSupporterWritePersistentState(seed));
    CHECK([DORHSupporterReadPersistentState() isEqual:seed]);
    CHECK(rootAttempts == 0);
    [testDefaults setObject:@"stale" forKey:DORHSupporterLicenseDefaultsKey];
    denyOrdinary = YES; NSError *error = nil;
    CHECK(!DORHSupporterStoreLicenseCode(@"valid-one", &error));
    CHECK(error.code == 9 && rootAttempts == 0);
    CHECK([[testDefaults stringForKey:DORHSupporterLicenseDefaultsKey] isEqual:@"stale"]);
    CHECK(notifications == 0 && invalidations == 0);
    jailbreakActive = YES;
    CHECK(!DORHSupporterStoreLicenseCode(@"valid-one", &error));
    CHECK(rootAttempts > 0 && notifications == 0);
    allowRoot = YES;
    CHECK(DORHSupporterStoreLicenseCode(@"valid-one", &error));
    NSDictionary *saved = DORHSupporterReadPersistentState();
    CHECK([saved[@"DeviceCode"] isEqual:@"stable-code"] && [saved[@"BindingRequired"] boolValue]);
    CHECK([saved[@"LicenseCode"] isEqual:@"valid-one"] && saved[@"LicenseRemoved"] == nil);
    CHECK([[testDefaults stringForKey:DORHSupporterLicenseDefaultsKey] isEqual:@"valid-one"]);
    CHECK(notifications == 1 && invalidations == 1 && !rootScope && !unsandboxedScope);
    NSUInteger oldWrites = writes, oldAttempts = rootAttempts;
    CHECK(!DORHSupporterStoreLicenseCode(@"invalid", &error));
    CHECK(writes == oldWrites && rootAttempts == oldAttempts);
    denyAllWrites = YES;
    CHECK(!DORHSupporterStoreLicenseCode(@"valid-two", &error));
    CHECK([DORHSupporterReadPersistentState() isEqual:saved]);
    CHECK([[testDefaults stringForKey:DORHSupporterLicenseDefaultsKey] isEqual:@"valid-one"]);
    CHECK(!DORHSupporterRemoveLicense() && notifications == 1);
    denyAllWrites = NO;
    CHECK(DORHSupporterRemoveLicense());
    CHECK(DORHSupporterLicenseTombstoned());
    CHECK([DORHSupporterPersistentString(@"DeviceCode") isEqual:@"stable-code"]);
    CHECK(DORHSupporterPersistentString(@"LicenseCode") == nil);
    CHECK([testDefaults objectForKey:DORHSupporterLicenseDefaultsKey] == nil);
    CHECK(notifications == 2 && invalidations == 2 && !rootScope && !unsandboxedScope);
    CHECK(DORHSupporterStoreLicenseCode(@"valid-two", &error));
    CHECK(!DORHSupporterLicenseTombstoned());
    installedThroughTrollStore = YES; denyOrdinary = NO; oldAttempts = rootAttempts;
    CHECK([DORHSupporterPersistentString(@"LicenseCode") isEqual:@"valid-two"]);
    CHECK(DORHSupporterStoreLicenseCode(@"valid-three", &error));
    CHECK(rootAttempts == oldAttempts);
    [NSNotificationCenter.defaultCenter removeObserver:observer];
    [testDefaults removePersistentDomainForName:suite];
    return 0;
} }
