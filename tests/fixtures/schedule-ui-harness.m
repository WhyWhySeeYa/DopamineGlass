// Real schedule controllers, with only file/daemon I/O replaced by a small fake.
#include <notify.h>
/* PRODUCTION_SCHEDULE_RUNTIME_HEADERS */
/* PRODUCTION_SCHEDULE_HEADERS */

@interface DOEnvironmentManager : NSObject
@property(nonatomic, strong) NSDictionary *lowConfig;
@property(nonatomic, strong) NSDictionary *lowState;
@property(nonatomic, strong) NSDictionary *batteryConfig;
@property(nonatomic, strong) NSDictionary *batteryState;
+ (instancetype)sharedManager;
- (NSDictionary *)lowPowerScheduleConfiguration;
- (NSDictionary *)lowPowerScheduleStatus;
- (NSDictionary *)batteryRecordConfiguration;
- (NSDictionary *)batteryRecordStatus;
- (BOOL)saveLowPowerScheduleConfiguration:(NSDictionary *)configuration error:(NSError **)error;
- (BOOL)saveBatteryRecordConfiguration:(NSDictionary *)configuration error:(NSError **)error;
- (NSString *)sendBatteryRecordCommand:(NSString *)command error:(NSError **)error;
@end
@implementation DOEnvironmentManager
+ (instancetype)sharedManager { static id manager; if (!manager) manager = [self new]; return manager; }
- (NSDictionary *)lowPowerScheduleConfiguration { return self.lowConfig ?: rcLowPowerDefaultConfiguration(); }
- (NSDictionary *)lowPowerScheduleStatus { return self.lowState ?: @{}; }
- (NSDictionary *)batteryRecordConfiguration { return self.batteryConfig ?: rcBatteryDefaultConfiguration(); }
- (NSDictionary *)batteryRecordStatus { return self.batteryState ?: @{}; }
- (BOOL)saveLowPowerScheduleConfiguration:(NSDictionary *)configuration error:(NSError **)error
{
    self.lowConfig = configuration;
    return YES;
}
- (BOOL)saveBatteryRecordConfiguration:(NSDictionary *)configuration error:(NSError **)error { self.batteryConfig = configuration; return YES; }
- (NSString *)sendBatteryRecordCommand:(NSString *)command error:(NSError **)error { return NSUUID.UUID.UUIDString; }
@end

static NSString *ScheduleLocalizedString(NSString *key)
{
    static NSDictionary *strings;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ strings = @{ /* PRODUCTION_SCHEDULE_STRINGS */ }; });
    return strings[key] ?: key;
}
#undef DOLocalizedString
#define DOLocalizedString(key) ScheduleLocalizedString(key)
/* PRODUCTION_SCHEDULE_CONTROLLERS */

@interface ScheduleTestPan : UIPanGestureRecognizer
@property(nonatomic) CGPoint testOffset;
@property(nonatomic) CGPoint testVelocity;
@end

@implementation ScheduleTestPan
- (UIGestureRecognizerState)state { return UIGestureRecognizerStateEnded; }
- (CGPoint)translationInView:(UIView *)view { return self.testOffset; }
- (CGPoint)velocityInView:(UIView *)view { return self.testVelocity; }
@end

static void ScheduleLabels(UIView *view, NSString *text, NSMutableArray<UILabel *> *labels)
{
    if (view.hidden || view.alpha == 0) return;
    if ([view isKindOfClass:UILabel.class] && [((UILabel *)view).text isEqual:text]) [labels addObject:(id)view];
    for (UIView *child in view.subviews) ScheduleLabels(child, text, labels);
}

static void CheckScheduleBackdrops(DOLowPowerScheduleController *page)
{
    // Do not call refreshScheduleGlassFrames here: UIKit must trigger alignment
    // itself, including when estimated heights change during scrolling.
    [page.tableView layoutIfNeeded];
    CHECK(page.sectionGlassViews.count == page.tableView.numberOfSections);
    for (NSInteger section = 0; section < page.tableView.numberOfSections; section++) {
        DOCustomLiquidGlassView *glass = page.sectionGlassViews[@(section)];
        CHECK(glass && !glass.hidden && glass.superview == page.tableView.backgroundView);
        NSInteger rows = [page.tableView numberOfRowsInSection:section];
        CGRect first = [page.tableView rectForRowAtIndexPath:[NSIndexPath indexPathForRow:0 inSection:section]];
        CGRect last = [page.tableView rectForRowAtIndexPath:[NSIndexPath indexPathForRow:rows - 1 inSection:section]];
        CGRect expected = CGRectInset(CGRectUnion(first, last), 1, 0.5);
        CGRect actual = [glass convertRect:glass.bounds toView:page.tableView];
        CHECK(fabs(CGRectGetMinY(actual) - CGRectGetMinY(expected)) < 0.5);
        CHECK(fabs(CGRectGetMaxY(actual) - CGRectGetMaxY(expected)) < 0.5);
        CHECK(fabs(CGRectGetMinX(actual) - CGRectGetMinX(expected)) < 0.5);
        CHECK(fabs(CGRectGetWidth(actual) - CGRectGetWidth(expected)) < 0.5);
        CGRect header = [page.tableView rectForHeaderInSection:section];
        CGRect footer = [page.tableView rectForFooterInSection:section];
        if (CGRectGetMinY(actual) < CGRectGetMaxY(header) - 0.5)
            @throw [NSException exceptionWithName:@"LayoutFailure"
                reason:[NSString stringWithFormat:@"schedule header overlap: page=%@ section=%ld actual=%@ first=%@ last=%@ header=%@ footer=%@ bounds=%@ expanded=%d",
                    NSStringFromClass(page.class), (long)section, NSStringFromCGRect(actual), NSStringFromCGRect(first),
                    NSStringFromCGRect(last), NSStringFromCGRect(header), NSStringFromCGRect(footer),
                    NSStringFromCGRect(page.tableView.bounds), page.timePickerExpanded] userInfo:nil];
        CHECK(CGRectGetMaxY(actual) <= CGRectGetMinY(footer) + 0.5);
    }
    for (UITableViewCell *cell in page.tableView.visibleCells) {
        NSIndexPath *path = [page.tableView indexPathForCell:cell];
        if (!path || CGRectGetHeight(cell.bounds) < 2) continue;
        DOCustomLiquidGlassView *glass = page.sectionGlassViews[@(path.section)];
        CGRect actual = [glass convertRect:glass.bounds toView:page.tableView];
        CGRect row = [cell convertRect:cell.bounds toView:page.tableView];
        CHECK(CGRectGetMinY(actual) <= CGRectGetMinY(row) + 1);
        CHECK(CGRectGetMaxY(actual) >= CGRectGetMaxY(row) - 1);
    }
    CHECK(page.tableView.backgroundView.subviews.count == page.sectionGlassViews.count);
}

@interface ScheduleWindowTestPage : DOLowPowerScheduleController
@property(nonatomic, strong) NSDate *testNow;
@property(nonatomic, strong) UIAlertController *capturedAlert;
@end

@implementation ScheduleWindowTestPage
- (NSDate *)scheduleNow { return self.testNow; }
- (void)presentViewController:(UIViewController *)controller animated:(BOOL)animated completion:(void (^)(void))completion
{
    self.capturedAlert = (UIAlertController *)controller;
}
@end

static void CheckScheduleStartChoices(void)
{
    DOEnvironmentManager *env = DOEnvironmentManager.sharedManager;
    NSDictionary *original = env.lowConfig;
    ScheduleWindowTestPage *page = [ScheduleWindowTestPage new];
    NSCalendar *calendar = rcLowPowerLocalCalendar();
    page.testNow = [calendar dateBySettingHour:0 minute:33 second:0 ofDate:NSDate.date options:0];
    [page loadViewIfNeeded];
    page.lastStartMinute = 31;
    page.lastEndMinute = 390;
    page.enabledSwitch.on = YES;
    [page.enabledSwitch sendActionsForControlEvents:UIControlEventValueChanged];
    CHECK(!page.enabledSwitch.on && env.lowConfig == original);
    NSArray *titles = [page.capturedAlert.actions valueForKey:@"title"];
    CHECK(([titles isEqual:@[DOLocalizedString(@"LowPowerSchedule_StartNow"),
        DOLocalizedString(@"LowPowerSchedule_WaitForNext"), DOLocalizedString(@"LowPowerSchedule_AdjustTime")]]));
    NSDate *end = [calendar dateBySettingHour:6 minute:30 second:0 ofDate:page.testNow options:0];
    [page enablePlanSkippingThrough:end];
    CHECK([env.lowConfig[@"Enabled"] boolValue] && [env.lowConfig[@"SkipThrough"] isEqual:end]);
    page.enabledSwitch.on = NO;
    [page.enabledSwitch sendActionsForControlEvents:UIControlEventValueChanged];
    CHECK(![env.lowConfig[@"Enabled"] boolValue] && env.lowConfig[@"SkipThrough"] == nil);
    CHECK([env.lowConfig[@"DisableRequest"] isEqual:env.lowConfig[@"Revision"]]);
    [page enablePlanSkippingThrough:nil];
    CHECK([env.lowConfig[@"Enabled"] boolValue] && env.lowConfig[@"SkipThrough"] == nil && env.lowConfig[@"DisableRequest"] == nil);
    env.lowConfig = original;
}

static NSUInteger CheckScheduleUI(UIViewController *host, NSString *documents)
{
    CheckScheduleStartChoices();
    UINavigationController *nav = [[UINavigationController alloc] initWithRootViewController:[UIViewController new]];
    nav.navigationBarHidden = YES;
    [host addChildViewController:nav];
    nav.view.frame = host.view.bounds;
    [host.view addSubview:nav.view];
    [nav didMoveToParentViewController:host];
    DOPowerScheduleController *container = [DOPowerScheduleController new];
    [nav pushViewController:container animated:NO];
    [nav.view layoutIfNeeded];
    DOLowPowerScheduleController *low = container.pages[0];
    CHECK(container.pagePan.delegate == container && container.pagePan.view == container.contentView);
    ScheduleTestPan *swipe = [[ScheduleTestPan alloc] initWithTarget:nil action:NULL];
    swipe.testOffset = CGPointMake(-20, 80);
    [container pagePanned:swipe];
    CHECK(container.selectedPage == low);
    swipe.testOffset = CGPointMake(-8, 0);
    [container pagePanned:swipe];
    CHECK(container.selectedPage == low);
    swipe.testOffset = CGPointMake(-75, 5);
    [container pagePanned:swipe];
    [container finishPageTransition];
    CHECK(container.selectedPage == container.pages[1] && container.modeControl.selectedIndex == 1);
    [container pagePanned:swipe]; // No wrapping past the last page.
    CHECK(container.selectedPage == container.pages[1]);
    swipe.testOffset = CGPointMake(75, 5);
    [container pagePanned:swipe];
    [container finishPageTransition];
    CHECK(container.selectedPage == low && container.modeControl.selectedIndex == 0);
    container.contentView.semanticContentAttribute = UISemanticContentAttributeForceRightToLeft;
    CHECK([container pageIndexForHorizontalMovement:75] == 1);
    container.contentView.semanticContentAttribute = UISemanticContentAttributeUnspecified;
    // Keep the first enable outside its window regardless of the test clock.
    NSDateComponents *nowComponents = [rcLowPowerLocalCalendar() components:NSCalendarUnitHour | NSCalendarUnitMinute fromDate:NSDate.date];
    NSInteger nowMinute = nowComponents.hour * 60 + nowComponents.minute;
    NSInteger start = (nowMinute + 10) % 1440, end = (nowMinute + 20) % 1440;
    low.lastStartMinute = start;
    low.lastEndMinute = end;
    low.enabledSwitch.on = YES;
    [low draftChanged];
    CHECK(low.hasChanges && low.saveEnabled);
    [container selectPage:1];
    [container finishPageTransition];
    DOBatteryRecordController *battery = (id)container.selectedPage;
    CHECK(battery != (id)low && !battery.enabledSwitch.on);
    [container selectPage:0];
    [container finishPageTransition];
    CHECK(low.hasChanges && low.lastStartMinute == start);
    [low savePressed];
    CHECK(!low.hasChanges && !low.saveEnabled);
    CHECK([low.feedbackLabel.text isEqual:DOLocalizedString(@"PowerSchedule_Saved")]);
    CHECK([low.statusText isEqual:DOLocalizedString(@"LowPowerSchedule_Confirming")]);
    for (NSString *state in @[@"timerFailed", @"calendarFailed", @"runtimeFailed"]) {
        DOEnvironmentManager.sharedManager.lowState = @{@"Revision": low.savedConfiguration[@"Revision"],
            @"Updated": NSDate.date, @"State": state};
        [low refreshStatus];
        CHECK([low.statusText isEqual:DOLocalizedString(@"LowPowerSchedule_RuntimeFailed")]);
    }
    DOEnvironmentManager.sharedManager.lowState = nil;
    [low refreshStatus];
    [container selectPage:1];
    [container finishPageTransition];
    [battery tableView:battery.tableView didSelectRowAtIndexPath:[NSIndexPath indexPathForRow:5 inSection:0]];
    CHECK(battery.lastStartMinute == start && battery.lastEndMinute == end);
    battery.enabledSwitch.on = YES;
    [battery draftChanged];
    [battery tableView:battery.tableView didSelectRowAtIndexPath:[NSIndexPath indexPathForRow:1 inSection:0]];
    [battery.tableView scrollToRowAtIndexPath:[NSIndexPath indexPathForRow:3 inSection:0]
        atScrollPosition:UITableViewScrollPositionMiddle animated:NO];
    [battery.tableView layoutIfNeeded];
    CHECK(battery.timePickerExpanded && battery.timePicker.superview != nil);
    [battery savePressed];
    CHECK(!battery.timePickerExpanded && !battery.hasChanges && !battery.saveEnabled);
    CHECK([battery.statusText isEqual:[NSString stringWithFormat:DOLocalizedString(@"BatteryRecord_PlannedAt"), DOScheduleDateText(battery.savedConfiguration[@"FirstStart"])]]);
    CHECK(![battery.statusText containsString:@"Unavailable"]);
    CHECK([DOEnvironmentManager.sharedManager.lowConfig[@"StartMinute"] integerValue] == start);
    CHECK(![battery.savedConfiguration[@"Revision"] isEqual:low.savedConfiguration[@"Revision"]]);
    BOOL edgeFound = NO;
    for (UIGestureRecognizer *gesture in battery.view.gestureRecognizers)
        if ([gesture isKindOfClass:UIScreenEdgePanGestureRecognizer.class]) edgeFound = YES;
    CHECK(edgeFound);
    // An acknowledged command produces feedback; no command is needed to preview a plan.
    battery.pendingCommand = @"test-command";
    DOEnvironmentManager.sharedManager.batteryState = @{@"Revision": battery.savedConfiguration[@"Revision"],
        @"Updated": NSDate.date, @"CommandID": @"test-command", @"CommandResult": @"stopped", @"History": @[]};
    [battery refreshStatus];
    CHECK(battery.pendingCommand == nil);
    CHECK([battery.feedbackLabel.text isEqual:DOLocalizedString(@"BatteryRecord_Result_stopped")]);
    CHECK([battery tableView:battery.tableView numberOfRowsInSection:1] == 1);
    UITableViewCell *status = [battery tableView:battery.tableView cellForRowAtIndexPath:[NSIndexPath indexPathForRow:0 inSection:1]];
    CHECK(status.accessoryView == nil && status.selectionStyle == UITableViewCellSelectionStyleNone);
    CHECK(status.detailTextLabel.text.length == 0);
    CHECK(!(status.accessibilityTraits & UIAccessibilityTraitButton));
    // Rapid switching and interruption must leave one visible page and one shared control.
    DOScheduleModeControl *mode = container.modeControl;
    for (NSUInteger i = 0; i < 8; i++) [container selectPage:i % 2];
    [container finishPageTransition];
    CHECK(container.modeControl == mode && container.childViewControllers.count == 2);
    CHECK(container.contentView.userInteractionEnabled);
    CHECK(container.selectedPage.view.maskView == nil && container.pageAnimator == nil);
    CHECK(low.view.hidden != battery.view.hidden);
    CHECK(low.hasChanges == NO && battery.hasChanges == NO);
    NSMutableArray *history = [NSMutableArray new];
    for (NSUInteger index = 0; index < 60; index++)
        [history addObject:@{@"Recorded": [NSDate dateWithTimeIntervalSinceNow:-(double)index * 3600],
            @"Result": @"interrupted"}];
    DOEnvironmentManager.sharedManager.batteryState = @{@"Revision": battery.savedConfiguration[@"Revision"],
        @"Updated": NSDate.date, @"History": history};
    [battery refreshStatus];
    NSUInteger cases = 0;
    for (NSValue *size in @[[NSValue valueWithCGSize:CGSizeMake(320, 568)],
        [NSValue valueWithCGSize:CGSizeMake(393, 852)], [NSValue valueWithCGSize:CGSizeMake(834, 1194)]]) {
        nav.view.frame = (CGRect){CGPointZero, size.CGSizeValue};
        [nav.view layoutIfNeeded];
        for (NSInteger pageIndex = 0; pageIndex < 2; pageIndex++) {
            HarnessProgress([NSString stringWithFormat:@"schedule page=%ld size=%@", (long)pageIndex, NSStringFromCGSize(size.CGSizeValue)]);
            [container selectPage:pageIndex];
            [container finishPageTransition];
            DOLowPowerScheduleController *page = container.selectedPage;
            [page.view layoutIfNeeded];
            [page.tableView reloadData];
            [page.tableView layoutIfNeeded];
            // Batch updates retire their old header/footer views on the next
            // run-loop turn, even when row animations are disabled. Poll until
            // every section exposes at most one mounted footer label: a fixed
            // sleep is not reliable on slower CI runners.
            for (NSUInteger settle = 0; settle < 20; settle++) {
                [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
                [page.tableView layoutIfNeeded];
                BOOL clean = YES;
                for (NSInteger s = 0; s < page.tableView.numberOfSections; s++) {
                    NSMutableArray<UILabel *> *probe = [NSMutableArray new];
                    ScheduleLabels(page.tableView, [page footerTextForSection:s], probe);
                    if (probe.count > 1) { clean = NO; break; }
                }
                if (clean) break;
            }
            [page.tableView layoutIfNeeded];
            CheckScheduleBackdrops(page);
            CHECK(page.sectionGlassViews.count >= 2);
            for (NSInteger section = 0; section < page.tableView.numberOfSections; section++) {
                HarnessProgress([NSString stringWithFormat:@"schedule footer=%ld", (long)section]);
                DOCustomLiquidGlassView *glass = page.sectionGlassViews[@(section)];
                CHECK(glass && !glass.hidden);
                CGRect footer = [page.tableView rectForFooterInSection:section];
                CHECK(CGRectGetMaxY([glass convertRect:glass.bounds toView:page.tableView]) <= CGRectGetMinY(footer) + 0.5);
                CHECK([page tableView:page.tableView heightForFooterInSection:section] >= 36);
                CHECK(![page respondsToSelector:@selector(tableView:titleForFooterInSection:)]);
                // Inspect actual mounted labels; geometry alone missed the duplicate footer.
                NSMutableArray<UILabel *> *labels = [NSMutableArray new];
                // Estimated self-sizing rows can move a footer after the first
                // scroll. Locate the final rect before asserting mounted labels.
                for (NSUInteger attempt = 0; attempt < 8; attempt++) {
                    footer = [page.tableView rectForFooterInSection:section];
                    [page.tableView scrollRectToVisible:footer animated:NO];
                    [page.tableView layoutIfNeeded];
                    [labels removeAllObjects];
                    ScheduleLabels(page.tableView, [page footerTextForSection:section], labels);
                    if (labels.count) break;
                }
                CheckScheduleBackdrops(page);
                footer = [page.tableView rectForFooterInSection:section];
                NSMutableArray *labelFrames = [NSMutableArray new];
                for (UILabel *mounted in labels) [labelFrames addObject:NSStringFromCGRect([mounted convertRect:mounted.bounds toView:page.tableView])];
                if (labels.count != 1) @throw [NSException exceptionWithName:@"LayoutFailure"
                    reason:[NSString stringWithFormat:@"schedule footer: page=%ld section=%ld labels=%lu viewport=%@ footer=%@ bounds=%@ content=%@ hidden=%d alpha=%.2f labelFrames=%@",
                        (long)pageIndex, (long)section, (unsigned long)labels.count, NSStringFromCGSize(size.CGSizeValue),
                        NSStringFromCGRect(footer), NSStringFromCGRect(page.tableView.bounds), NSStringFromCGSize(page.tableView.contentSize),
                        page.tableView.hidden, page.tableView.alpha, labelFrames] userInfo:nil];
                UILabel *label = labels.firstObject;
                CGRect textFrame = [label convertRect:label.bounds toView:page.tableView];
                CHECK(CGRectGetMinY(textFrame) >= CGRectGetMinY(footer) + 15);
                CHECK(CGRectGetMaxY(textFrame) <= CGRectGetMaxY(footer) - 19);
                [page refreshStatus];
                NSMutableArray<UILabel *> *after = [NSMutableArray new];
                ScheduleLabels(page.tableView, [page footerTextForSection:section], after);
                CHECK(after.count == 1 && after.firstObject == label);
            }
            [page.tableView setContentOffset:CGPointMake(0, 100) animated:NO];
            CheckScheduleBackdrops(page);
            NSDictionary *backdrops = [page.sectionGlassViews copy];
            for (NSUInteger pass = 0; pass < 12; pass++) {
                HarnessProgress([NSString stringWithFormat:@"schedule expansion=%lu", (unsigned long)pass]);
                [page setTimePickerExpanded:pass % 2 == 0 animated:NO];
                [page.tableView setContentOffset:CGPointMake(0, pass % 2 ? 0 : 100) animated:NO];
                CheckScheduleBackdrops(page);
                CHECK([page.sectionGlassViews isEqualToDictionary:backdrops]);
            }
            if (pageIndex == 1) {
                CHECK([page.tableView numberOfRowsInSection:2] == 60);
                for (NSInteger row = 0; row < 60; row += 7) {
                    HarnessProgress([NSString stringWithFormat:@"schedule history row=%ld", (long)row]);
                    [page.tableView scrollToRowAtIndexPath:[NSIndexPath indexPathForRow:row inSection:2]
                        atScrollPosition:UITableViewScrollPositionMiddle animated:NO];
                    CheckScheduleBackdrops(page);
                    CHECK([page.sectionGlassViews isEqualToDictionary:backdrops]);
                }
            }
            CHECK(!page.view.hasAmbiguousLayout);
            [mode layoutIfNeeded];
            CHECK(fabs(mode.layer.cornerRadius - CGRectGetHeight(mode.bounds) / 2) < 0.5);
            CHECK(fabs(mode.selectionView.layer.cornerRadius - CGRectGetHeight(mode.selectionView.bounds) / 2) < 0.5);
            [page.tableView setContentOffset:CGPointZero animated:NO];
            [page.view layoutIfNeeded];
            Snapshot(container, [NSString stringWithFormat:@"schedule-%ld-%.0fx%.0f.png", (long)pageIndex, size.CGSizeValue.width, size.CGSizeValue.height], documents);
            cases++;
        }
    }
    // Switching appearance must preserve the user's unsaved schedule.
    NSInteger draftStart = low.lastStartMinute;
    for (NSNumber *authorized in @[@NO, @YES]) {
        TestAuthorization = authorized.boolValue;
        [container refreshContainerAppearance:nil];
        CGFloat alpha = TestAuthorization ? 0 : 1;
        CHECK(CGColorGetAlpha(container.view.backgroundColor.CGColor) == alpha);
        for (DOLowPowerScheduleController *page in container.pages) {
            [page refreshScheduleAppearance];
            CHECK(CGColorGetAlpha(page.view.backgroundColor.CGColor) == alpha);
            if (TestAuthorization) CheckScheduleBackdrops(page);
            else for (DOCustomLiquidGlassView *glass in page.sectionGlassViews.allValues) CHECK(glass.hidden);
        }
        CHECK(low.lastStartMinute == draftStart);
    }
    [nav willMoveToParentViewController:nil];
    [nav.view removeFromSuperview];
    [nav removeFromParentViewController];
    // The table's layout callback and notification handlers must not retain pages.
    __weak DOPowerScheduleController *releasedContainer;
    __weak DOLowPowerScheduleController *releasedLow;
    __weak DOLowPowerScheduleController *releasedBattery;
    @autoreleasepool {
        DOPowerScheduleController *temporary = [DOPowerScheduleController new];
        [temporary loadViewIfNeeded];
        [temporary.view layoutIfNeeded];
        releasedContainer = temporary;
        releasedLow = temporary.pages[0];
        releasedBattery = temporary.pages[1];
    }
    CHECK(!releasedContainer && !releasedLow && !releasedBattery);
    return cases;
}
