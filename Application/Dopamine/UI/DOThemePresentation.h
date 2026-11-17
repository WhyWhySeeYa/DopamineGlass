#pragma once
#import "DOThemeManager.h"
#import "DOPreferenceManager.h"
#import "DOSupporterLicense.h"

static inline BOOL DOIsCustomGlassThemeSelected(void)
{
    id value = [[DOPreferenceManager sharedManager] preferenceValueForKey:@"theme"];
    return [value isKindOfClass:NSString.class] && [value isEqualToString:@"custom_glass"];
}

// Authorization enables only the optional theme, never jailbreak operations.
static inline BOOL DOUsesCustomGlassTheme(void)
{
    return DOIsCustomGlassThemeSelected() && DORHSupporterIsVerified();
}
