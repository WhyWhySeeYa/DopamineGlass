#pragma once
#import "DOThemeManager.h"
#import "DOPreferenceManager.h"
#import "DOSupporterLicense.h"

static inline BOOL DOUsesCustomGlassTheme(void)
{
    return DORHSupporterIsVerified();
}
