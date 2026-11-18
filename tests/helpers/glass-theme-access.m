// Simulate an ordinary signed app; production theme transactions still use disk.
#import <objc/runtime.h>
static BOOL denyOrdinary, jailbreakActive, installedThroughTrollStore, allowRoot;
static BOOL rootScope, unsandboxedScope, throwAccess;
static NSUInteger rootAttempts;
static NSString *accessDirectory;
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
    NSCAssert(!rootScope && jailbreakActive && !installedThroughTrollStore, @"Unexpected scope");
    if (!allowRoot) return;
    rootScope = YES;
    block();
    rootScope = NO;
}
- (void)runUnsandboxed:(void (^)(void))block {
    NSCAssert(rootScope && !unsandboxedScope, @"Unexpected scope");
    unsandboxedScope = YES;
    block();
    unsandboxedScope = NO;
}
@end
@interface NSDictionary (GlassTestAccess)
+ (id)glass_dictionaryWithContentsOfFile:(NSString *)path;
@end
@implementation NSDictionary (GlassTestAccess)
+ (id)glass_dictionaryWithContentsOfFile:(NSString *)path {
    if ([path hasPrefix:accessDirectory] && denyOrdinary) {
        if (!unsandboxedScope) return nil;
        if (throwAccess) [NSException raise:@"TestDeniedRead" format:@"Simulated failure"];
    }
    return [self glass_dictionaryWithContentsOfFile:path];
}
@end
@interface NSFileManager (GlassTestAccess)
- (BOOL)glass_createDirectoryAtPath:(NSString *)path withIntermediateDirectories:(BOOL)intermediates
                        attributes:(NSDictionary *)attributes error:(NSError **)error;
@end
@implementation NSFileManager (GlassTestAccess)
- (BOOL)glass_createDirectoryAtPath:(NSString *)path withIntermediateDirectories:(BOOL)intermediates
                        attributes:(NSDictionary *)attributes error:(NSError **)error {
    if ([path isEqual:accessDirectory] && denyOrdinary && !unsandboxedScope) return NO;
    return [self glass_createDirectoryAtPath:path withIntermediateDirectories:intermediates attributes:attributes error:error];
}
@end
static void installGlassAccessSimulation(void) {
    method_exchangeImplementations(class_getClassMethod(NSDictionary.class, @selector(dictionaryWithContentsOfFile:)),
        class_getClassMethod(NSDictionary.class, @selector(glass_dictionaryWithContentsOfFile:)));
    method_exchangeImplementations(class_getInstanceMethod(NSFileManager.class, @selector(createDirectoryAtPath:withIntermediateDirectories:attributes:error:)),
        class_getInstanceMethod(NSFileManager.class, @selector(glass_createDirectoryAtPath:withIntermediateDirectories:attributes:error:)));
}
