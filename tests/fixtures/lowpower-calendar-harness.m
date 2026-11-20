#include <stdio.h>
#include <errno.h>
static int testRename(const char *source, const char *destination);
#define rename testRename
#import "RCLowPowerSchedule.h"
#undef rename
static BOOL failReplacement;
static int testRename(const char *source, const char *destination)
{
    if (failReplacement) { errno = EACCES; return -1; }
    return rename(source, destination);
}
#define CHECK(value) do { if (!(value)) { NSLog(@"FAIL line %d: %s", __LINE__, #value); abort(); } } while (0)

static NSDate *date(NSString *text)
{
    NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
    NSDate *value = [formatter dateFromString:text];
    CHECK(value != nil);
    return value;
}
static NSDictionary *config(NSInteger start, NSInteger end)
{
    return @{@"Version": @1, @"Enabled": @YES, @"StartMinute": @(start),
        @"EndMinute": @(end), @"Revision": NSUUID.UUID.UUIDString};
}
static void event(NSDictionary *configuration, NSCalendar *calendar, NSString *now,
                  BOOL next, NSString *expected, BOOL on)
{
    NSDictionary *result = rcLowPowerEvent(configuration, date(now), calendar, next);
    CHECK([result[@"Date"] isEqual:date(expected)]);
    CHECK([result[@"PowerMode"] boolValue] == on);
}
int main(int argc, const char *argv[])
{
    @autoreleasepool {
        NSCalendar *calendar = [[NSCalendar alloc] initWithCalendarIdentifier:NSCalendarIdentifierGregorian];
        calendar.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
        NSDictionary *overnight = config(22 * 60, 6 * 60);
        CHECK(rcLowPowerConfigurationValid(overnight));
        event(overnight, calendar, @"2026-11-21T23:00:00Z", YES, @"2026-11-22T06:00:00Z", NO);
        event(overnight, calendar, @"2026-11-21T23:00:00Z", NO, @"2026-11-21T22:00:00Z", YES);
        event(overnight, calendar, @"2026-11-22T06:00:00Z", NO, @"2026-11-22T06:00:00Z", NO);
        event(overnight, calendar, @"2026-11-22T06:00:00Z", YES, @"2026-11-22T22:00:00Z", YES);
        event(config(0, 360), calendar, @"2026-11-21T00:00:00Z", NO, @"2026-11-21T00:00:00Z", YES);
        CHECK(!rcLowPowerConfigurationValid(config(60, 60)));
        CHECK(!rcLowPowerMinuteValid(@YES) && !rcLowPowerMinuteValid(@1.5));
        CHECK(!rcLowPowerMinuteValid(@-1) && !rcLowPowerMinuteValid(@1440));
        CHECK(rcLowPowerEvent(@{}, NSDate.date, calendar, YES) == nil);
        CHECK(rcLowPowerConfigurationPath(@"/") == nil);
        CHECK(rcLowPowerConfigurationPath(@"relative") == nil);

        calendar.timeZone = [NSTimeZone timeZoneWithName:@"America/New_York"];
        // Missing 02:30 and 03:00 coincide at spring-forward: OFF wins.
        event(config(150, 180), calendar, @"2026-03-08T06:00:00Z", YES, @"2026-03-08T07:00:00Z", NO);
        // Fall-back repeats 01:30, but only its first occurrence belongs to the schedule.
        event(config(90, 180), calendar, @"2026-11-01T04:00:00Z", YES, @"2026-11-01T05:30:00Z", YES);
        event(config(90, 180), calendar, @"2026-11-01T06:00:00Z", YES, @"2026-11-01T08:00:00Z", NO);
        event(config(90, 180), calendar, @"2026-11-01T06:00:00Z", NO, @"2026-11-01T05:30:00Z", YES);

        NSString *root = [NSString stringWithUTF8String:argv[1]];
        NSString *file = rcLowPowerConfigurationPath(root);
        NSError *failure = nil;
        CHECK(rcLowPowerWriteDictionary(overnight, file, &failure));
        CHECK([rcLowPowerReadDictionary(file) isEqual:overnight]);
        failReplacement = YES;
        CHECK(!rcLowPowerWriteDictionary(config(60, 120), file, &failure));
        CHECK(failure.code == EACCES);
        CHECK([rcLowPowerReadDictionary(file) isEqual:overnight]);
        failReplacement = NO;
        NSArray *children = [NSFileManager.defaultManager contentsOfDirectoryAtPath:file.stringByDeletingLastPathComponent error:nil];
        CHECK(children.count == 1); // Failed replacements leave no temporary value behind.
        CHECK(!rcLowPowerWriteDictionary(overnight, nil, &failure) && failure.code == EINVAL);
        CHECK([rcLowPowerReadDictionary(file) isEqual:overnight]);
    }
    return 0;
}
