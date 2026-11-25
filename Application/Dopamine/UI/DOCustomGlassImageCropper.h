//
//  DOCustomGlassImageCropper.h
//  Dopamine
//
//  A minimal interactive cropper used by the custom glass theme picker.
//  The user can pan and pinch to choose the visible region; the crop frame
//  is fixed to the requested aspect ratio and shape.
//

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSInteger, DOCustomGlassCropShape) {
    DOCustomGlassCropShapeRectangle = 0,
    DOCustomGlassCropShapeCircle = 1,
};

@interface DOCustomGlassImageCropper : UIViewController

/// @param image       source image (already loaded, orientation normalized)
/// @param shape       rectangle or circle mask
/// @param aspectSize  crop frame aspect, e.g. CGSizeMake(9, 19.5) for a full screen wallpaper
/// @param completion  called with the rendered crop, or nil when cancelled
+ (instancetype)cropperWithImage:(UIImage *)image
                           shape:(DOCustomGlassCropShape)shape
                      aspectSize:(CGSize)aspectSize
                      completion:(void (^)(UIImage * _Nullable croppedImage))completion;

@end

NS_ASSUME_NONNULL_END
