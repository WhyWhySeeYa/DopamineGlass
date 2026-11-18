//
//  DOThemeManager.m
//  Dopamine
//
//  Created by tomt000 on 14/02/2024.
//

#import "DOThemeManager.h"
#import "DOPreferenceManager.h"
#import "DOSupporterLicense.h"

static NSString * const DOCustomGlassThemeKey = @"custom_glass";
static NSString * const DODefaultThemeKey = @"default";

@implementation DOThemeManager

+ (instancetype)sharedInstance
{
    static DOThemeManager *sharedManager = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sharedManager = [[DOThemeManager alloc] init];
    });
    return sharedManager;
}

- (id)init
{
    self = [super init];
    if (self) {
        self.themes = [[NSMutableArray alloc] init];
        
        NSString *path = [[NSBundle mainBundle] pathForResource:@"Themes" ofType:@"plist"];
        NSArray *themes = [NSArray arrayWithContentsOfFile:path];

        for (NSDictionary *theme in themes) {
            DOTheme *newTheme = [[DOTheme alloc] initWithDictionary:theme];
            [((NSMutableArray *)self.themes) addObject:newTheme];
        }

    }
    return self;
}

- (NSArray*)getAvailableThemeKeys
{
    NSMutableArray *keys = [[NSMutableArray alloc] init];
    BOOL supporterVerified = DORHSupporterIsVerified();
    for (DOTheme *theme in _themes) {
        if ([theme.key isEqualToString:DOCustomGlassThemeKey] && !supporterVerified)
            continue;
        [keys addObject:theme.key];
    }
    return keys;
}

- (NSArray*)getAvailableThemeNames
{
    NSMutableArray *names = [[NSMutableArray alloc] init];
    BOOL supporterVerified = DORHSupporterIsVerified();
    for (DOTheme *theme in _themes) {
        if ([theme.key isEqualToString:DOCustomGlassThemeKey] && !supporterVerified)
            continue;
        [names addObject:theme.name];
    }
    return names;
}

- (DOTheme*)getThemeForKey:(NSString*)key
{
    for (DOTheme *theme in _themes) {
        if ([theme.key isEqualToString:key]) {
            return theme;
        }
    }
    return nil;
}

- (DOTheme*)enabledTheme
{
    DOPreferenceManager *preferences = [DOPreferenceManager sharedManager];
    BOOL supporterVerified = DORHSupporterIsVerified();
    id value = [preferences preferenceValueForKey:@"theme"];

    if (![value isKindOfClass:NSString.class])
        value = DODefaultThemeKey;

    if ([value isEqualToString:DOCustomGlassThemeKey] && !supporterVerified) {
        // Fall back for this presentation without erasing the user's choice.
        value = DODefaultThemeKey;
    }

    DOTheme *theme = [self getThemeForKey:value];
    if (theme)
        return theme;

    return [self getThemeForKey:DODefaultThemeKey] ?: self.themes.firstObject;
}


+ (UIColor*)menuColorWithAlpha:(float)alpha
{
    DOTheme *theme = [[DOThemeManager sharedInstance] enabledTheme];
    
    UIColor *color = theme.actionMenuColor;
    CGFloat red, green, blue, currentAlpha;
    [color getRed:&red green:&green blue:&blue alpha:&currentAlpha];
    return [UIColor colorWithRed:red green:green blue:blue alpha:currentAlpha * alpha];
}


@end
