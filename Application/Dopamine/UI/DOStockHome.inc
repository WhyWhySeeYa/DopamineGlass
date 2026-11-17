// ZQBB stock home preserved from 3ac500e9d95553c2ffd651894315d79b31ee8aed.
// Included inside DOMainViewController implementation; not a separate compilation unit.
// Adaptations: helper selector names, shared lifecycle observers and layout super call.

-(void)setupStockHome
{
    self.contentView = [[UIView alloc] initWithFrame:self.view.bounds];
    [self.view addSubview:self.contentView];
    UIStackView *stackView = self.mainStack = [[UIStackView alloc] init];
    [stackView setAxis:UILayoutConstraintAxisVertical];
    [stackView setAlignment:UIStackViewAlignmentTrailing];
    [stackView setDistribution:UIStackViewDistributionEqualSpacing];
    stackView.spacing = 16;
    [stackView setTranslatesAutoresizingMaskIntoConstraints:NO];

    [self.contentView addSubview:stackView];
    [NSLayoutConstraint activateConstraints:@[
        [stackView.leadingAnchor constraintEqualToAnchor:self.contentView.leadingAnchor],
        [stackView.trailingAnchor constraintEqualToAnchor:self.contentView.trailingAnchor],
        [stackView.topAnchor constraintEqualToAnchor:self.contentView.topAnchor],
        [stackView.bottomAnchor constraintEqualToAnchor:self.contentView.bottomAnchor],
    ]];

    //Header
    DOHeaderView *headerView = [[DOHeaderView alloc] initWithImage: [UIImage imageNamed:@"Dopamine"] subtitles: @[
        [DOGlobalAppearance mainSubtitleString:[[DOEnvironmentManager sharedManager] versionSupportString]],
        [DOGlobalAppearance secondarySubtitleString:DOLocalizedString(@"Credits_Made_By")],
    ]];

    [stackView addArrangedSubview:headerView];
    // 版本与注入模式、应用构建信息、运行时长共用作者行的边界与行距。
    self.systemVersionLabel = [self addInformationRowToHeader:headerView titleKey:@"System version: %@"];
    self.appBuildInfoLabel = [self addInformationRowToHeader:headerView titleKey:@"Build version: %@"];
    self.appBuildTimeLabel = [self addInformationRowToHeader:headerView titleKey:@"Build time: %@"];
    self.systemUptimeLabel = [self addInformationRowToHeader:headerView titleKey:@"System boot time: %@"];
    NSString *issueNotice = [@"\n" stringByAppendingString:DOLocalizedString(@"If you encounter any issues, please reproduce them using the official version before reporting.")];
    [headerView addSubtitle:[DOGlobalAppearance secondarySubtitleString:issueNotice]];
    [self refreshStockSystemInformation];

    [NSLayoutConstraint activateConstraints:@[
        [headerView.leadingAnchor constraintEqualToAnchor:stackView.leadingAnchor constant:5],
        [headerView.trailingAnchor constraintEqualToAnchor:stackView.trailingAnchor]
    ]];

    //Action Menu
    DOActionMenuView *actionView = [[DOActionMenuView alloc] initWithActions:@[
        [UIAction actionWithTitle:DOLocalizedString(@"Menu_Settings_Title") image:[UIImage systemImageNamed:@"gearshape" withConfiguration:[DOGlobalAppearance smallIconImageConfiguration]] identifier:@"settings" handler:^(__kindof UIAction * _Nonnull action) {
            [self.navigationController pushViewController:[[DOSettingsController alloc] init] animated:YES];
        }],
        [UIAction actionWithTitle:DOLocalizedString(@"Menu_Restart_SpringBoard_Title") image:[UIImage systemImageNamed:@"arrow.clockwise" withConfiguration:[DOGlobalAppearance smallIconImageConfiguration]] identifier:@"respring" handler:^(__kindof UIAction * _Nonnull action) {
            [self fadeToBlack:^{
                [[DOEnvironmentManager sharedManager] respring];
            }];
        }],
        [UIAction actionWithTitle:DOLocalizedString(@"Menu_Reboot_Userspace_Title") image:[UIImage systemImageNamed:@"arrow.clockwise.circle" withConfiguration:[DOGlobalAppearance smallIconImageConfiguration]] identifier:@"reboot-userspace" handler:^(__kindof UIAction * _Nonnull action) {
            [self fadeToBlack:^{
                [[DOEnvironmentManager sharedManager] rebootUserspace];
            }];
        }],
        [UIAction actionWithTitle:DOLocalizedString(@"Menu_Credits_Title") image:[UIImage systemImageNamed:@"info.circle" withConfiguration:[DOGlobalAppearance smallIconImageConfiguration]] identifier:@"credits" handler:^(__kindof UIAction * _Nonnull action) {
            [self.navigationController pushViewController:[[DOCreditsViewController alloc] init] animated:YES];
        }]
    ] delegate:self];

    [stackView addArrangedSubview: actionView];

    [NSLayoutConstraint activateConstraints:@[
        [actionView.leadingAnchor constraintEqualToAnchor:stackView.leadingAnchor],
        [actionView.trailingAnchor constraintEqualToAnchor:stackView.trailingAnchor],
    ]];


    UIView *buttonPlaceHolder = [[UIView alloc] init];
    [buttonPlaceHolder setTranslatesAutoresizingMaskIntoConstraints:NO];
    [stackView addArrangedSubview:buttonPlaceHolder];
    [NSLayoutConstraint activateConstraints:@[
        [buttonPlaceHolder.heightAnchor constraintEqualToConstant:60],
    ]];

    //Jailbreak Button
    BOOL isJailbroken = [[DOEnvironmentManager sharedManager] isJailbroken] || [[DOEnvironmentManager sharedManager] isJailbrokenWithOtherJailbreak];
    BOOL isSupported = [[DOEnvironmentManager sharedManager] isSupported];

    NSString *jailbreakButtonTitle = [self jailbreakButtonTitle];

    UIImage *jailbreakButtonImage;
    if (isSupported)
        jailbreakButtonImage = [UIImage systemImageNamed:@"lock.open" withConfiguration:[DOGlobalAppearance smallIconImageConfiguration]];
    else
        jailbreakButtonImage = [UIImage systemImageNamed:@"lock.slash" withConfiguration:[DOGlobalAppearance smallIconImageConfiguration]];

    self.jailbreakBtn = [[DOJailbreakButton alloc] initWithAction: [UIAction actionWithTitle:jailbreakButtonTitle image:jailbreakButtonImage identifier:@"jailbreak" handler:^(__kindof UIAction * _Nonnull action) {


/********************************** roothide specific ************************************/
        if(otherJailbreakActived(false)) {
            UIAlertController *alertController = [UIAlertController alertControllerWithTitle:DOLocalizedString(@"Error") message:DOLocalizedString(@"Your device currently has another jailbreak activated, please reboot device.") preferredStyle:UIAlertControllerStyleAlert];
            UIAlertAction *rebootAction = [UIAlertAction actionWithTitle:DOLocalizedString(@"Button_Close") style:UIAlertActionStyleDefault handler:^(UIAlertAction * _Nonnull action) {
                //exit(0);
            }];
            [alertController addAction:rebootAction];
            [self presentViewController:alertController animated:YES completion:nil];
            return;
        }
/********************************** roothide specific ************************************/


        [actionView hide];
        // 移出缩放容器后固定动画起点，避免日志初始化布局时位置归零。
        CGRect buttonFrame = [self.jailbreakBtn convertRect:self.jailbreakBtn.bounds toView:self.view];
        [NSLayoutConstraint deactivateConstraints:self.jailbreakButtonConstraints];
        [self.view addSubview:self.jailbreakBtn];
        [NSLayoutConstraint activateConstraints:(self.jailbreakButtonConstraints = @[
            [self.jailbreakBtn.leftAnchor constraintEqualToAnchor:self.view.leftAnchor constant:CGRectGetMinX(buttonFrame)],
            [self.jailbreakBtn.topAnchor constraintEqualToAnchor:self.view.topAnchor constant:CGRectGetMinY(buttonFrame)],
            [self.jailbreakBtn.widthAnchor constraintEqualToConstant:CGRectGetWidth(buttonFrame)],
            [self.jailbreakBtn.heightAnchor constraintEqualToConstant:CGRectGetHeight(buttonFrame)]
        ])];
        [self.jailbreakBtn expandButton: self.jailbreakButtonConstraints];

        self.updateButton.userInteractionEnabled = NO;
        [UIView animateWithDuration:0.75 delay:0 usingSpringWithDamping:0.9 initialSpringVelocity:2.0  options: UIViewAnimationOptionCurveEaseInOut animations:^{
            [headerView setTransform:CGAffineTransformMakeTranslation(0, -25)];
            self.updateButton.alpha = 0;
        } completion:nil];

        [self startJailbreak];

    }]];
    self.jailbreakBtn.enabled = !isJailbroken && isSupported;

    [self.contentView addSubview:self.jailbreakBtn];

    [NSLayoutConstraint activateConstraints:(self.jailbreakButtonConstraints = @[
        [self.jailbreakBtn.leadingAnchor constraintEqualToAnchor:stackView.leadingAnchor],
        [self.jailbreakBtn.trailingAnchor constraintEqualToAnchor:stackView.trailingAnchor],
        [self.jailbreakBtn.heightAnchor constraintEqualToAnchor:buttonPlaceHolder.heightAnchor],
        [self.jailbreakBtn.centerYAnchor constraintEqualToAnchor:buttonPlaceHolder.centerYAnchor]
    ])];

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 0.1 * NSEC_PER_SEC), dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_LOW, 0), ^{
        if ([[DOUIManager sharedInstance] environmentUpdateAvailable])
        {
            dispatch_async(dispatch_get_main_queue(), ^{
                [self setupUpdateAvailable:YES];
            });
        }
        else if ([[DOUIManager sharedInstance] isUpdateAvailable])
        {
            dispatch_async(dispatch_get_main_queue(), ^{
                [self setupUpdateAvailable:NO];
            });
        }
    });
}

- (void)layoutStockHome
{
    if (self.jailbreakBtn.didExpand) return;
    CGRect safeFrame = self.view.safeAreaLayoutGuide.layoutFrame;
    BOOL isPad = UIDevice.currentDevice.userInterfaceIdiom == UIUserInterfaceIdiomPad;
    CGFloat width = isPad ? MIN(safeFrame.size.width * 0.8, UI_IPAD_MAX_WIDTH) : MAX(375, safeFrame.size.width) - UI_PADDING * 2;
    CGFloat availableHeight = MIN(safeFrame.size.height - 24, self.view.bounds.size.height * ([DOGlobalAppearance isHomeButtonDevice] ? 0.78 : 0.73));
    if (width <= 0 || availableHeight <= 0) return;
    CGSize size = [self.mainStack systemLayoutSizeFittingSize:CGSizeMake(width, 0) withHorizontalFittingPriority:UILayoutPriorityRequired verticalFittingPriority:UILayoutPriorityFittingSizeLevel];
    CGFloat height = MAX(size.height, availableHeight);
    CGFloat scale = MIN(1, MIN((safeFrame.size.width - UI_PADDING * 2) / width, availableHeight / height));
    self.contentView.bounds = CGRectMake(0, 0, width, height);
    self.contentView.center = CGPointMake(CGRectGetMidX(safeFrame), CGRectGetMidY(safeFrame));
    self.contentView.transform = CGAffineTransformMakeScale(scale, scale);
}

- (NSString *)stockSystemUptimeDescription
{
    static mach_timebase_info_data_t timebase;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{ mach_timebase_info(&timebase); });
    if (timebase.denom == 0) return DOLocalizedString(@"Unknown");
    uint64_t seconds = (uint64_t)((double)mach_continuous_time() * timebase.numer / timebase.denom / NSEC_PER_SEC);
    return [NSString stringWithFormat:DOLocalizedString(@"Uptime_Format"),
        (unsigned long long)(seconds / 86400), (unsigned long long)(seconds / 3600 % 24),
        (unsigned long long)(seconds / 60 % 60), (unsigned long long)(seconds % 60)];
}

- (NSString *)appBuildTimeDescription
{
    NSTimeInterval timestamp = [[[NSBundle mainBundle] objectForInfoDictionaryKey:@"DOBuildTimestamp"] doubleValue];
    if (timestamp <= 0) return DOLocalizedString(@"Unknown");
    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    formatter.locale = [[NSLocale alloc] initWithLocaleIdentifier:@"en_US_POSIX"];
    formatter.timeZone = [NSTimeZone localTimeZone];
    formatter.dateFormat = @"yyyy-MM-dd HH:mm:ss";
    return [formatter stringFromDate:[NSDate dateWithTimeIntervalSince1970:timestamp]];
}

- (UILabel *)addInformationRowToHeader:(DOHeaderView *)header titleKey:(NSString *)key
{
    NSString *title = [[NSString stringWithFormat:DOLocalizedString(key), @""] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
    return [header addInformationRowWithTitle:[DOGlobalAppearance secondarySubtitleString:title]];
}

- (void)refreshStockSystemInformation
{
    DOEnvironmentManager *environment = [DOEnvironmentManager sharedManager];
    NSString *versionAndMode = [NSString stringWithFormat:@"%@ (%@)", environment.systemVersion ?: UIDevice.currentDevice.systemVersion, environment.injectionModeDescription];
    self.systemVersionLabel.attributedText = [DOGlobalAppearance secondarySubtitleString:versionAndMode];
    self.appBuildInfoLabel.attributedText = [DOGlobalAppearance secondarySubtitleString:environment.appVersion ?: DOLocalizedString(@"Unknown")];
    self.appBuildTimeLabel.attributedText = [DOGlobalAppearance secondarySubtitleString:[self appBuildTimeDescription]];
    [self refreshStockSystemUptime];
}

- (void)refreshStockSystemUptime
{
    self.systemUptimeLabel.attributedText = [DOGlobalAppearance secondarySubtitleString:[self stockSystemUptimeDescription]];
}

- (void)resumeStockSystemInformationUpdates
{
    if (!self.informationVisible) return;
    [self refreshStockSystemInformation];
    if (self.uptimeTimer || UIApplication.sharedApplication.applicationState != UIApplicationStateActive) return;
    __weak typeof(self) weakSelf = self;
    self.uptimeTimer = [NSTimer timerWithTimeInterval:1 repeats:YES block:^(NSTimer *timer) {
        [weakSelf refreshStockSystemUptime];
    }];
    [[NSRunLoop mainRunLoop] addTimer:self.uptimeTimer forMode:NSRunLoopCommonModes];
}

-(void)setupStockUpdateAvailable:(BOOL)environmentUpdate
{
    if (self.jailbreakBtn.didExpand)
        return;

    NSString *title = environmentUpdate ? DOLocalizedString(@"Button_Update_Environment") : DOLocalizedString(@"Button_Update_Available");

    NSString *releaseFrom = [[DOUIManager sharedInstance] getLaunchedReleaseTag];
    NSString *releaseTo = [[DOUIManager sharedInstance] getLatestReleaseTag];

    if (environmentUpdate)
    {
/************************************* roothide specfic ***********************************/
        releaseFrom = [[DOEnvironmentManager sharedManager] jailbrokenVersionRootHide];
/************************************* roothide specfic ***********************************/
        releaseTo = [[DOUIManager sharedInstance] getLaunchedReleaseTag];
    }

    self.updateButton = [DOActionMenuButton buttonWithAction:[UIAction actionWithTitle:title image:[UIImage systemImageNamed:@"arrow.down.circle" withConfiguration:[DOGlobalAppearance smallIconImageConfiguration]] identifier:@"update-available" handler:^(__kindof UIAction * _Nonnull action) {
        [self.navigationController pushViewController:[[DOUpdateViewController alloc] initFromTag:releaseFrom toTag:releaseTo] animated:YES];
    }] chevron:NO];

    self.updateButton.translatesAutoresizingMaskIntoConstraints = NO;
    [self.contentView addSubview:self.updateButton];

    // 为更新入口预留间距，随内容一起参与小屏布局。
    [self.mainStack setCustomSpacing:[DOGlobalAppearance isHomeButtonDevice] ? 50 : 60 afterView:self.mainStack.arrangedSubviews[1]];

    [NSLayoutConstraint activateConstraints:@[
        [self.updateButton.centerXAnchor constraintEqualToAnchor:self.contentView.centerXAnchor],
        [self.updateButton.heightAnchor constraintEqualToConstant:30],
        [self.updateButton.bottomAnchor constraintEqualToAnchor:self.mainStack.arrangedSubviews.lastObject.topAnchor constant:[DOGlobalAppearance isHomeButtonDevice] ? -10 : -20]
    ]];

    [self.updateButton setTransform:CGAffineTransformMakeTranslation(0, 25)];
    [self.updateButton setAlpha:0];
    [UIView animateWithDuration:0.5 delay:0 usingSpringWithDamping:0.9 initialSpringVelocity:2.0  options: UIViewAnimationOptionCurveEaseInOut animations:^{
        [self.updateButton setTransform:CGAffineTransformIdentity];
        [self.updateButton setAlpha:1];
    } completion:nil];
}
